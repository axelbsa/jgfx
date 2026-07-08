# Procedural Geometry

A guide to generating meshes in code with the `geometry` namespace, feeding
them to [`Mesh`](../api/mesh.md), and rendering them through a
[`Camera`](../api/camera.md). Covers the built-in cube / plane / sphere
generators, the vertex data they produce, the winding convention, and the
`math` helpers the camera relies on.

## The core insight

**The generators produce plain data. `Mesh` uploads it. The two are separate
steps on purpose.**

Every generator in the `geometry` namespace returns a plain
`{ vertices, indices }` object — no GPU, no context, nothing allocated on the
device. `vertices` is an ordinary array of vertex objects
(`{ position, normal, texcoord0 }`), and `indices` is an ordinary array of
numbers. Nothing touches WebGPU until you hand that object to `Mesh`, which
packs and uploads it.

That split is what makes the generators trivial to read, cheap to test, and
easy to post-process: you can displace positions, recolor vertices, or merge
two shapes as plain JavaScript before a single byte reaches the GPU.

```js
import { geometry } from "../../jgfx/index.js";

const cube = geometry.cube({ size: 1.5 });
// cube.vertices → [{ position, normal, texcoord0 }, ...]  (24 entries)
// cube.indices  → [0, 2, 1, 0, 3, 2, ...]                 (36 entries)
```

## The standard vertex

jgfx uses one 96-byte vertex format for every mesh, so a single pipeline vertex
layout works everywhere. The generators fill in three fields:

| Field | What it is | Generators set |
|-------|-----------|----------------|
| `position` | XYZ position, model space | Always |
| `normal` | Outward surface normal | Always |
| `texcoord0` | UV coordinates | Always |

Every other field (`tangent`, `texcoord1`, `color`, `joints`, `weights`) is
left off. When `Mesh` packs the vertex it fills the missing fields from
sensible defaults — most notably `color` defaults to opaque white `(1, 1, 1, 1)`
so an untinted mesh is still visible and you can tint it in a shader. See
[Buffers, Layouts & Pipeline](buffers-layouts-pipeline.md) for the full field
table and byte offsets.

Because the generators leave a vertex as a small object, you are free to add
fields yourself before building the mesh:

```js
const geo = geometry.sphere({ radius: 0.8 });
for (const v of geo.vertices) {
  v.color = [v.normal[0] * 0.5 + 0.5, v.normal[1] * 0.5 + 0.5, 1, 1];
}
```

## Winding: why the triangles look "backwards"

The generators emit triangles that are **clockwise when viewed from outside the
shape, in model space**. That reads backwards versus the familiar OpenGL
"counter-clockwise is front" convention — and it is deliberate.

WebGPU resolves front- versus back-facing in *framebuffer* space, and the
framebuffer's Y axis points **down**. That vertical flip reverses apparent
winding: a triangle wound clockwise-from-outside in model space lands
counter-clockwise-from-outside once it is rasterized on screen.

So with WebGPU's default front-face rule (`frontFace: "ccw"`), the exterior
faces come out as the *front* faces. Turn on back-face culling
(`cullMode: "back"`) and the interior is culled while the exterior stays —
no per-mesh front-face override needed. jgfx's pipeline default is
`cullMode: "none"` (nothing is culled), but the winding is chosen so that the
moment you opt into culling, the right side survives:

```js
const pipeline = ctx.createPipeline({
  shader,
  depthTest: true,
  cullMode: "back",   // exteriors show, interiors are culled
  vertexLayouts: [Mesh.vertexLayout()],
});
```

See [Pipeline](../api/pipeline.md) for the full list of primitive-state
defaults.

## The generators

All three take a single options object with defaults, so `geometry.cube()`
works and `geometry.cube({ size: 2 })` overrides just what you name.

### Cube — `geometry.cube({ size = 1 })`

An axis-aligned cube centered at the origin. It produces **24 vertices**, not
8: each of the 6 faces gets its own 4 corners so it can carry a single hard,
axis-aligned face normal. Sharing the 8 geometric corners would force one
averaged normal per corner and smooth the edges — wrong for a cube. Each face
is a quad split into two triangles, giving **36 indices / 12 triangles**.

```js
const { vertices, indices } = geometry.cube({ size: 1.5 });
// 24 vertices, 36 indices. Face normals are exactly ±X / ±Y / ±Z.
```

### Plane — `geometry.plane({ size = 1, segments = 1 })`

A flat quad lying on the XZ ground plane, centered at the origin, facing up
(`normal = [0, 1, 0]`). `segments` subdivides it into a grid, which is what you
want for heightmap displacement or per-vertex effects. A plane with `segments`
divisions has `(segments + 1)²` vertices and `2 × segments²` triangles. UVs run
`[0,1]` across the grid.

```js
const { vertices, indices } = geometry.plane({ size: 2, segments: 4 });
// segments: 4 → 25 vertices, 32 triangles.
```

### Sphere — `geometry.sphere({ radius = 0.5, segments = 32, rings = 16 })`

A UV sphere centered at the origin, using latitude/longitude
parameterization. `rings` walks pole to pole (the polar angle `0..π`),
`segments` walks around the equator (`0..2π`). Each vertex's normal is just its
normalized position — the surface of a sphere is its own normal. The last column
duplicates the first (`u = 0` and `u = 1` are the same point) so a texture does
not seam where the UV wraps. Vertex count is `(segments + 1) × (rings + 1)`.

```js
const { vertices, indices } = geometry.sphere({ radius: 0.8, segments: 24, rings: 16 });
```

## From generator to Mesh

Hand the `{ vertices, indices }` straight to `Mesh`. The constructor packs the
vertex objects into the 96-byte interleaved layout and uploads both a vertex
buffer and a `uint32` index buffer:

```js
import { Context, Mesh, geometry } from "../../jgfx/index.js";

const geo = geometry.cube({ size: 1.5 });

// Either construct directly...
const mesh = new Mesh(ctx, geo.vertices, geo.indices);

// ...or use the context helper (identical result):
const mesh2 = ctx.createMesh(geo.vertices, geo.indices);
```

`Mesh` exposes `draw(pass)` for an indexed draw and `drawInstanced(pass, n)`
for instancing, plus `Mesh.vertexLayout()` for the pipeline. Those are covered
in depth in [Buffers, Layouts & Pipeline](buffers-layouts-pipeline.md).

## Rendering with a Camera

A [`Camera`](../api/camera.md) owns the projection and view matrices in one
uniform buffer (two `mat4x4<f32>` back to back). You create it, wire its buffer
into a bind group, `write()` it when it changes, and `bind()` it on the pass.
`fovy` is given in **degrees** for readability and converted internally.

```js
const camera = ctx.createCamera({
  fovy: 45,
  eye: [0, 3, -8],
  center: [0, 0, 0],   // up defaults to [0, 1, 0]
});
const cameraBG = shader.createBindGroupBuffers(0, [camera.buffer]);
```

A matching shader takes the camera at group 0 and a per-object model matrix at
group 1. The fragment stage below turns the surface normal into color
(`normal * 0.5 + 0.5`), which doubles as a correctness check — a face pointing
+X reads reddish, +Y greenish, +Z bluish:

```wgsl
struct Camera { projection: mat4x4f, view: mat4x4f };
struct Object { model: mat4x4f };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> object: Object;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
};

@vertex fn vs_main(@location(0) position: vec3f, @location(1) normal: vec3f) -> VSOut {
  let worldPos = object.model * vec4f(position, 1.0);
  var o: VSOut;
  o.position = camera.projection * camera.view * worldPos;
  o.normal = normalize((object.model * vec4f(normal, 0.0)).xyz);
  return o;
}

@fragment fn fs_main(@location(0) normal: vec3f) -> @location(0) vec4f {
  return vec4f(normal * 0.5 + 0.5, 1.0);
}
```

Put it together in a render loop. Note the vertex shader reads `@location(0)`
(position) and `@location(1)` (normal) straight out of the standard vertex
layout that `Mesh.vertexLayout()` describes:

```js
const shader = ctx.createShader("primitives", wgsl, {
  groups: [
    { bindings: [{ binding: 0, minBindingSize: 128 }] }, // camera (2 × mat4)
    { bindings: [{ binding: 0, minBindingSize: 64 }] },  // model (1 × mat4)
  ],
});
const pipeline = ctx.createPipeline({
  shader,
  depthTest: true,
  vertexLayouts: [Mesh.vertexLayout()],
});

const mesh = ctx.createMesh(...Object.values(geometry.sphere({ radius: 0.8 })));
const object = ctx.createUniform(shader, 1, new Float32Array(16));

let t = 0;
function render() {
  t += 0.016;
  camera.write();

  const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);
    camera.bind(frame.pass, cameraBG, 0);

    object.data.set(mat4.rotationY(t)); // spin it
    object.write();
    frame.pass.setBindGroup(1, object.bindGroup);
    mesh.draw(frame.pass);

    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

## The `math` namespace

The camera's matrices come from `math`, a tiny column-major matrix/vector
library imported the same way as `geometry`:

```js
import { math } from "../../jgfx/index.js";
// or: import { mat4, vec3, radians } from "../../jgfx/math.js";
```

A few conventions matter when you build model transforms by hand:

- **Left-handed** coordinate system: after the view transform, +Z points *away*
  from the viewer, into the screen. `lookAt`'s forward axis is
  `normalize(center - eye)`.
- **Depth is [0, 1]** (WebGPU/D3D/Vulkan), not OpenGL's [-1, 1].
- **Angles are radians.** Use `math.radians(deg)` to convert; `Camera` takes
  degrees and converts for you.
- Matrices are `Float32Array(16)` in **column-major** order — exactly what
  `mat4x4<f32>` expects, so they upload with no transpose.

`mat4` provides `identity`, `multiply`, `perspective`, `ortho`, `lookAt`, plus
convenience builders `translation`, `scaling`, and `rotationX/Y/Z`. Composition
follows the usual convention: `multiply(a, b)` applies `b` first, then `a`, so a
translated-and-spun object is:

```js
const model = mat4.multiply(
  mat4.translation(x, y, z),
  mat4.rotationY(math.radians(30)),
);
```

`vec3` covers the vector operations the camera needs — `add`, `sub`, `scale`,
`dot`, `cross`, `length`, `normalize` — on plain `[x, y, z]` arrays.

## Next steps

- **[Buffers, Layouts & Pipeline](buffers-layouts-pipeline.md)** — how the
  standard vertex, `Mesh.vertexLayout()`, and `createPipeline` fit together.
- **[Mesh](../api/mesh.md)** — the full mesh reference.
- **[Camera](../api/camera.md)** — projection/view details and matrix layout.
