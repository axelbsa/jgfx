# Mesh

Vertex data + index data + GPU buffers for renderable geometry.

**File:** `mesh.js`

Every jgfx mesh uses one standardized **96-byte vertex**, so a single pipeline
[vertex layout](#meshvertexlayout) works everywhere. You can hand `Mesh` either an
array of plain vertex objects — which it packs for you — or an already-interleaved
`ArrayBuffer` / typed array you built yourself. Indices are always **32-bit**
(`uint32`).

Create a mesh with [`ctx.createMesh(vertices, indices)`](context.md) (or `new Mesh(ctx, vertices, indices)`).

---

## The standard vertex

All meshes share the layout below. It mirrors `CgfxVertex` exactly (96 bytes,
tightly packed) and covers the glTF 2.0 attributes plus skeletal animation.

| Field | Byte offset | Elements | Location | Type |
|-------|-------------|----------|----------|------|
| `position` | 0 | 3 | 0 | `float32x3` |
| `normal` | 12 | 3 | 1 | `float32x3` |
| `tangent` | 24 | 4 | 2 | `float32x4` |
| `texcoord0` | 40 | 2 | 3 | `float32x2` |
| `texcoord1` | 48 | 2 | 4 | `float32x2` |
| `color` | 56 | 4 | 5 | `float32x4` |
| `joints` | 72 | 4 | 6 | `uint16x4` |
| `weights` | 80 | 4 | 7 | `float32x4` |

Stride is **96 bytes**. Every field is `Float32` except `joints`, which is stored
as four `Uint16` (skeletal bone indices). `tangent.w` carries the handedness sign;
`weights` should sum to 1.0.

### Per-field defaults

When you pass vertex objects, any field you omit is filled from these defaults:

| Field | Default |
|-------|---------|
| `position` | `[0, 0, 0]` |
| `normal` | `[0, 0, 0]` |
| `tangent` | `[0, 0, 0, 0]` |
| `texcoord0` | `[0, 0]` |
| `texcoord1` | `[0, 0]` |
| `color` | `[1, 1, 1, 1]` |
| `joints` | `[0, 0, 0, 0]` |
| `weights` | `[0, 0, 0, 0]` |

!!! note "Color defaults to opaque white"
    Unlike cgfx's zero-initialized (black) vertices, `color` defaults to opaque
    white `[1, 1, 1, 1]`, so an untinted mesh is still visible. Everything else
    defaults to zero.

!!! note "Winding convention"
    jgfx builds geometry with **clockwise (CW) winding in model space**. The
    built-in [`geometry.*`](../guides/procedural-geometry.md) helpers follow this,
    which combines with the framebuffer Y-flip to show solid exteriors under a
    conventional `frontFace: "ccw"` + `cullMode: "back"` pipeline. See
    [Procedural Geometry](../guides/procedural-geometry.md).

---

## Constructor

### ctx.createMesh

Create a mesh from vertex and index data and upload it to the GPU.

```js
const mesh = ctx.createMesh(vertices, indices);
// or: const mesh = new Mesh(ctx, vertices, indices);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `vertices` | `Array<object>` \| `ArrayBuffer` \| `ArrayBufferView` | An array of vertex objects (see below), or already-packed interleaved data. |
| `indices` | `number[]` \| `Uint32Array` | Triangle indices (a multiple of 3 for `triangle-list`). Uploaded as `uint32`. |

If `vertices` is an array, it is packed with [`Mesh.packVertices`](#meshpackvertices).
Otherwise the buffer is uploaded as-is; the vertex count is inferred as
`byteLength / 96`.

A vertex object may carry any subset of the standard fields:

```js
{ position, normal, tangent, texcoord0, texcoord1, color, joints, weights }
```

**Returns** a `Mesh`. Creation failures throw a `JgfxError`; free the mesh with
[`mesh.destroy()`](#meshdestroy).

---

## Public fields

| Field | Type | Description |
|-------|------|-------------|
| `vertexBuffer` | [`Buffer`](buffer.md) | GPU vertex buffer (standard-vertex array). |
| `indexBuffer` | [`Buffer`](buffer.md) | GPU index buffer (`uint32` array). |
| `indexCount` | `number` | Number of indices (= number of draw elements). |

---

## Static methods

### Mesh.vertexLayout

Return the `GPUVertexBufferLayout` describing the standard vertex — stride 96,
eight attributes at shader locations 0–7. Pass it to `createPipeline`'s
`vertexLayouts`.

```js
const pipeline = ctx.createPipeline({
  shader,
  vertexLayouts: [Mesh.vertexLayout()],
});
```

**Returns:** `GPUVertexBufferLayout` with `arrayStride: 96`, `stepMode: "vertex"`,
and the eight attributes from the [standard-vertex table](#the-standard-vertex).

See [Pipeline](pipeline.md) for the full pipeline descriptor.

---

### Mesh.packVertices

Pack an array of vertex objects into the 96-byte interleaved layout, handling the
mixed `Float32` / `Uint16` fields. Missing fields take the
[defaults](#per-field-defaults). You rarely call this directly — `createMesh` does
it for you — but it is useful for pre-building buffers.

```js
const packed = Mesh.packVertices([
  { position: [0, 0.5, 0], color: [1, 0, 0, 1] },
  { position: [-0.5, -0.5, 0], color: [0, 1, 0, 1] },
  { position: [0.5, -0.5, 0], color: [0, 0, 1, 1] },
]);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `verts` | `Array<object>` | Vertex objects to pack. |

**Returns:** `ArrayBuffer` of `verts.length * 96` bytes.

---

## Instance methods

### mesh.draw

Bind the mesh's buffers and issue an indexed draw for a single instance.

```js
mesh.draw(frame.pass);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pass` | `GPURenderPassEncoder` | Active render pass (from `ctx.beginFrame()`). |

Records three commands: sets the vertex buffer at slot 0, sets the index buffer as
`uint32`, and draws `indexCount` indices as one instance.

!!! note "Set the pipeline first"
    The pipeline must already be set on the pass before you call `draw`. Meshes and
    pipelines are decoupled, so the same mesh can be drawn with different pipelines
    (e.g. a shadow pass and a color pass).

---

### mesh.drawInstanced

Indexed instanced draw. Same as [`draw`](#meshdraw) but with a caller-supplied
instance count.

```js
frame.pass.setVertexBuffer(1, instances.buffer, 0, instances.size);
cube.drawInstanced(frame.pass, COUNT);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pass` | `GPURenderPassEncoder` | Active render pass. |
| `instanceCount` | `number` | Number of instances to draw. |

For per-instance data, set a second vertex buffer at **slot 1** (`stepMode:
"instance"`) *before* calling, and include its layout in the pipeline's
`vertexLayouts`. Give the per-instance attributes shader locations that don't
collide with the standard vertex's 0–7 (the example below starts at 8).

```js
const instanceLayout = {
  arrayStride: 5 * 4 * 4, // 5 vec4f = 80 bytes
  stepMode: "instance",
  attributes: [8, 9, 10, 11, 12].map((loc, i) => ({
    format: "float32x4",
    offset: i * 16,
    shaderLocation: loc,
  })),
};

const pipeline = ctx.createPipeline({
  shader,
  vertexLayouts: [Mesh.vertexLayout(), instanceLayout],
});
```

---

### mesh.destroy

Release both GPU buffers. After this the mesh must not be used (`indexCount`
are released).

```js
mesh.destroy();
```

---

## Usage

### Matching WGSL shader

Declare vertex inputs matching the locations you use — a shader only needs the
attributes it actually reads, so unused locations can be omitted:

```wgsl
struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) tangent: vec4f,
  @location(3) texcoord0: vec2f,
  @location(4) texcoord1: vec2f,
  @location(5) color: vec4f,
  @location(6) joints: vec4<u32>,
  @location(7) weights: vec4f,
};
```

### Full mesh example

```js
import { Context, Mesh } from "./jgfx/index.js";

const ctx = await Context.create({ canvas });
const shader = ctx.createShader("tri", wgsl);
const pipeline = ctx.createPipeline({
  shader,
  vertexLayouts: [Mesh.vertexLayout()],
});

const mesh = ctx.createMesh(
  [
    { position: [0, 0.5, 0], color: [1, 0, 0, 1] },
    { position: [-0.5, -0.5, 0], color: [0, 1, 0, 1] },
    { position: [0.5, -0.5, 0], color: [0, 0, 1, 1] },
  ],
  [0, 1, 2],
);

function render() {
  const frame = ctx.beginFrame([0.1, 0.1, 0.2, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);
    mesh.draw(frame.pass);
    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

### Procedural geometry

The [`geometry.*`](../guides/procedural-geometry.md) helpers return
`{ vertices, indices }` ready to hand to `createMesh`:

```js
import { geometry } from "./jgfx/index.js";

const { vertices, indices } = geometry.cube({ size: 1.5 });
const cube = ctx.createMesh(vertices, indices);
```

See the **primitives** and **instanced_rendering** examples for full working pages,
and the [Procedural Geometry](../guides/procedural-geometry.md) guide for the winding
convention.
