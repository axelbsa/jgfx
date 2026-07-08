# Buffers, Layouts, and the Pipeline

A guide to the buffer-related pieces in jgfx / WebGPU and how they connect: the
standard 96-byte vertex, the layout that describes it, and how both feed
`ctx.createPipeline`.

## The core insight

**Buffers are DATA. Layouts are DESCRIPTION. They meet only at draw time,
matched by slot number.**

They begin as separate things. The data lives on the GPU in a
[`Buffer`](../api/buffer.md); the description is baked into the
[pipeline](../api/pipeline.md) when you create it. Neither knows about the other
until a draw call binds them together by slot.

That decoupling is what lets one pipeline draw a thousand different meshes: each
`setVertexBuffer` swaps the data, while the description stays fixed.

## The standard 96-byte vertex

Every [`Mesh`](../api/mesh.md) uses one interleaved vertex, tightly packed to 96
bytes, so a single pipeline layout works for all of them:

```
field:    position  normal  tangent  texcoord0 texcoord1  color   joints  weights
type:     f32x3     f32x3   f32x4    f32x2     f32x2      f32x4   u16x4   f32x4
bytes:    12        12      16       8         8          16      8       16
offset:   0         12      24       40        48         56      72      80
location: 0         1       2        3         4          5       6       7
```

Two details to note: `joints` is the one field stored as `uint16x4` (skinning
indices), and the whole record is 96 bytes with `location` running 0–7. Those
locations are exactly the `@location(N)` slots you read in a vertex shader.

You rarely build this by hand. `Mesh` packs an array of vertex objects into it
for you, filling omitted fields from defaults (notably `color` → opaque white):

```js
const mesh = ctx.createMesh(
  [{ position: [0, 0, 0], normal: [0, 1, 0] }, /* ... */],
  [0, 1, 2],
);
```

But you *can* hand `Mesh` an already-interleaved `ArrayBuffer` / `Float32Array`
if you built the 96-byte records yourself — the constructor takes either.

## `Mesh.vertexLayout()` — the matching description

`Mesh.vertexLayout()` returns the `GPUVertexBufferLayout` that describes the
standard vertex, guaranteed to match the packing above:

```js
Mesh.vertexLayout()
// →
// {
//   arrayStride: 96,
//   stepMode: "vertex",
//   attributes: [
//     { format: "float32x3", offset:  0, shaderLocation: 0 }, // position
//     { format: "float32x3", offset: 12, shaderLocation: 1 }, // normal
//     { format: "float32x4", offset: 24, shaderLocation: 2 }, // tangent
//     { format: "float32x2", offset: 40, shaderLocation: 3 }, // texcoord0
//     { format: "float32x2", offset: 48, shaderLocation: 4 }, // texcoord1
//     { format: "float32x4", offset: 56, shaderLocation: 5 }, // color
//     { format: "uint16x4",  offset: 72, shaderLocation: 6 }, // joints
//     { format: "float32x4", offset: 80, shaderLocation: 7 }, // weights
//   ],
// }
```

Three things line up here, and all three must agree:

1. **Buffer bytes** — the interleaved data `Mesh` uploaded.
2. **Attributes** — each `offset` / `format` says where a field sits and how to
   read it.
3. **Shader `@location(N)`** — `shaderLocation` routes each attribute to the
   matching input in your WGSL.

A shader only has to declare the locations it actually uses. The
normal-visualizer below reads position and normal and ignores the rest:

```wgsl
@vertex fn vs_main(@location(0) position: vec3f, @location(1) normal: vec3f) -> VSOut {
  // ...
}
```

## From raw Buffer to Mesh

`Mesh` is a thin bundle over two [`Buffer`](../api/buffer.md)s. Understanding
what it does makes the manual path (below) obvious.

A `Buffer` wraps a `GPUBuffer` plus its `size` and element `count`. jgfx offers
typed creators — `Buffer.vertex`, `Buffer.index`, `Buffer.uniform`,
`Buffer.storage`, `Buffer.mapping` — each picking the right usage flags.
(Sizes are rounded up to a multiple of 4 bytes, as WebGPU requires; `size`
reflects the aligned value.)

When you call `ctx.createMesh(vertices, indices)`, `Mesh`:

1. Packs the vertex objects into the 96-byte layout (or takes your packed data
   as-is).
2. Uploads it via `Buffer.vertex(ctx, packed, vertexCount)` →
   `VERTEX | COPY_DST`.
3. Converts the indices to a `Uint32Array` and uploads via
   `Buffer.index(ctx, indices)` → `INDEX | COPY_DST`, recording `indexCount`.

So a `Mesh` holds `vertexBuffer`, `indexBuffer`, and `indexCount` — nothing more.

### Doing it by hand

You do not have to use `Mesh`. The **vertex_attribute** example binds a bare
vertex buffer with its own hand-written layout — no `Mesh` in sight:

```js
const vertexData = new Float32Array([
  -0.5, -0.5,   0.5, -0.5,   0.0, 0.5,   // one triangle, 2D positions
]);
const vertexCount = vertexData.length / 2;

const vertexBuffer = ctx.createVertexBuffer(vertexData, vertexCount);

/** @type {GPUVertexBufferLayout} */
const layout = {
  arrayStride: 2 * 4,                 // two f32 per vertex
  stepMode: "vertex",
  attributes: [{ shaderLocation: 0, format: "float32x2", offset: 0 }],
};

const pipeline = ctx.createPipeline({ shader, vertexLayouts: [layout] });
```

This is the same machinery `Mesh` uses, just with your own stride and
attributes. The rule is simply: the layout must describe the data you bound.

!!! bug "Stride mismatch"
    If `arrayStride` disagrees with the real stride of the bound data, the GPU
    marches at the stride you *declared* through records of a different size —
    a few vertices come out right, then garbage. WebGPU cannot detect this; the
    two sides simply disagree about the shape. Binding a 96-byte `Mesh` vertex
    buffer against an `arrayStride: 8` layout is the classic version of this
    bug. For standard vertices, always use `Mesh.vertexLayout()`.

## Feeding the pipeline

`ctx.createPipeline` bakes the layout in at creation. Pass your layouts as
`vertexLayouts` (an array — one entry per vertex buffer slot):

```js
const pipeline = ctx.createPipeline({
  shader,
  depthTest: true,
  vertexLayouts: [Mesh.vertexLayout()],   // slot 0 = standard vertex
});
```

`shader` is the only required field; everything else has a default (triangle
list, `frontFace: "ccw"`, `cullMode: "none"`, opaque, single surface-format
target, entry points `vs_main` / `fs_main`). The full descriptor is documented
in the [Pipeline](../api/pipeline.md) reference.

## Index buffers and the draw helpers

`Mesh` always builds a **`uint32`** index buffer — jgfx does not use 16-bit
indices — so index arrays can be plain JS numbers or a `Uint32Array` and the
count is taken from the array length.

`Mesh` gives you two draw helpers that bind its buffers and issue an indexed
draw on a raw `GPURenderPassEncoder`:

```js
// Single indexed draw: binds vertex slot 0 + the uint32 index buffer,
// then drawIndexed(indexCount).
mesh.draw(frame.pass);

// Instanced: same buffers, drawIndexed(indexCount, instanceCount).
// Bind your per-instance data at vertex slot 1 (stepMode "instance") first.
mesh.drawInstanced(frame.pass, instanceCount);
```

For instancing, add a second entry to `vertexLayouts` with
`stepMode: "instance"` describing the per-instance buffer, and set that buffer
on slot 1 before calling `drawInstanced`.

## End to end

Putting the whole chain together — raw data → `Mesh` → pipeline → draw:

```js
import { Context, Mesh, geometry } from "../../jgfx/index.js";

const ctx = await Context.create({ canvas, depthBuffer: true });
const shader = ctx.createShader("mesh", wgsl);

// DATA: generate + upload. Mesh packs the 96-byte vertices and a uint32 index buffer.
const geo = geometry.cube({ size: 1.5 });
const mesh = ctx.createMesh(geo.vertices, geo.indices);

// DESCRIPTION: baked into the pipeline once.
const pipeline = ctx.createPipeline({
  shader,
  depthTest: true,
  vertexLayouts: [Mesh.vertexLayout()],
});

// DRAW TIME: they finally meet, matched by slot.
function render() {
  const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);   // use THIS description for the slots
    mesh.draw(frame.pass);              // DATA at slot 0 + indexed draw
    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

For each index `i`, the GPU reads bytes at `i * 96`, slices out each attribute
by its `offset`/`format`, and hands them to the shader at the matching
`@location`. One pipeline draws any standard-vertex mesh.

## Next steps

- **[Procedural Geometry](procedural-geometry.md)** — where the vertex data
  comes from, plus rendering with a camera.
- **[Buffer](../api/buffer.md)** — every typed creator and readback with
  `read()`.
- **[Mesh](../api/mesh.md)** and **[Pipeline](../api/pipeline.md)** — the full
  references.
