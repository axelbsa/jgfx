# Camera

Projection, view, and GPU uniform management for a 3D camera.

**File:** `camera.js`

A `Camera` owns a single uniform [buffer](buffer.md) holding
`[projection, view]` back to back — two `mat4x4<f32>` = **128 bytes** — matching a
WGSL struct of two `mat4`s. Like cgfx, the *caller* owns the bind group, so the
camera can share a group with other data (lights, time); build it with
[`shader.createBindGroupBuffers`](shader.md).

Create a camera with [`ctx.createCamera(desc)`](context.md) (or
`new Camera(ctx, desc)`).

!!! note "Left-handed, depth [0, 1]"
    jgfx's math (`math.js`) is **left-handed** with a clip-space depth range of
    **[0, 1]** — matching WebGPU's NDC conventions (and cgfx's cglm build, which
    forces `CGLM_FORCE_LEFT_HANDED` + `CGLM_FORCE_DEPTH_ZERO_TO_ONE`). `lookAt`'s
    forward axis is `normalize(center - eye)`, i.e. +Z points into the screen after
    the view transform.

!!! note "fovy in degrees"
    `fovy` is given in **degrees** for readability and converted to radians
    internally (as cgfx does).

---

## Constructor

### ctx.createCamera

Create a camera, compute its projection and view matrices, and upload them to the
GPU.

```js
const camera = ctx.createCamera({
  fovy: 45,
  eye: [0, 3, -8],
  center: [0, 0, 0],
});
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fovy` | `number` | `45` | Vertical field of view, in **degrees**. |
| `nearZ` | `number` | `0.01` | Near clipping plane. |
| `farZ` | `number` | `100` | Far clipping plane. |
| `eye` | `number[]` | `[0, 0, 0]` | Camera position `[x, y, z]`. |
| `center` | `number[]` | `[0, 0, 0]` | Look-at target `[x, y, z]`. |
| `up` | `number[]` | `[0, 1, 0]` | Up direction. |

The aspect ratio is computed automatically from `ctx.width / ctx.height`.

**Returns** a `Camera`. Check [`camera.ok`](#public-fields) before use; free it with
[`camera.destroy()`](#cameradestroy).

---

## Public fields

| Field | Type | Description |
|-------|------|-------------|
| `projection` | `Float32Array` | The projection matrix (16 floats, column-major). A subarray view into the uploaded block. |
| `view` | `Float32Array` | The view matrix (16 floats, column-major). A subarray view into the uploaded block. |
| `buffer` | [`Buffer`](buffer.md) | GPU uniform buffer (128 bytes). Pass to `shader.createBindGroupBuffers`. |
| `ok` | `boolean` | `true` if the buffer was created successfully. Check before use. |

!!! tip "In-place matrix edits"
    `projection` and `view` are live subarrays of the camera's upload block, so the
    layout on the GPU is a straight copy (projection first, then view). You can
    write into them directly, then call [`write()`](#camerawrite) to upload.

---

## Methods

### camera.perspective

Recompute the projection matrix. Returns `this` for chaining.

```js
camera.perspective(45, ctx.width / ctx.height, 0.01, 100);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fovyDeg` | `number` | Vertical field of view, in **degrees**. |
| `aspect` | `number` | Aspect ratio (width / height). |
| `nearZ` | `number` | Near clipping plane. |
| `farZ` | `number` | Far clipping plane. |

!!! tip "When to call"
    Call on window resize or when changing the field of view. Follow with
    [`write()`](#camerawrite) to upload the new matrix.

---

### camera.lookAt

Recompute the view matrix from eye/center/up. Returns `this` for chaining.

```js
camera.lookAt([Math.cos(angle) * 3, 1.5, Math.sin(angle) * 3], [0, 0, 0]);
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `eye` | `number[]` | — | Camera position. |
| `center` | `number[]` | — | Look-at target. |
| `up` | `number[]` | `[0, 1, 0]` | Up direction (must not be parallel to `center - eye`). |

---

### camera.write

Upload the current projection + view to the GPU. Call each frame, or after editing
the matrices via [`perspective`](#cameraperspective) / [`lookAt`](#cameralookat).

```js
camera.write();
```

---

### camera.bind

Set the camera's bind group on a render pass.

```js
camera.bind(frame.pass, cameraBG, 0);
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pass` | `GPURenderPassEncoder` | — | Active render pass. |
| `bindGroup` | `GPUBindGroup` | — | Bind group containing the camera buffer. |
| `groupIndex` | `number` | `0` | The `@group(N)` index to bind to. |

This is a thin convenience over `pass.setBindGroup(groupIndex, bindGroup)`.

---

### camera.destroy

Release the GPU uniform buffer. After this the camera must not be used (`buffer`
becomes `null` and `ok` becomes `false`).

```js
camera.destroy();
```

---

## Usage

### Matching WGSL shader

Declare a uniform struct with two `mat4x4f` fields, matching the GPU buffer layout
(projection first, then view):

```wgsl
struct Camera {
  projection: mat4x4f,
  view: mat4x4f,
};
@group(0) @binding(0) var<uniform> camera: Camera;
```

### Basic camera setup

```js
import { Context, Mesh, geometry } from "./jgfx/index.js";

const ctx = await Context.create({ canvas, depthBuffer: true });
const shader = ctx.createShader("scene", wgsl, {
  groups: [{ bindings: [{ binding: 0, minBindingSize: 128 }] }],
});
const pipeline = ctx.createPipeline({
  shader,
  depthTest: true,
  vertexLayouts: [Mesh.vertexLayout()],
});

const camera = ctx.createCamera({ fovy: 45, eye: [0, 3, -8], center: [0, 0, 0] });
const cameraBG = shader.createBindGroupBuffers(0, [camera.buffer]);

const { vertices, indices } = geometry.cube({ size: 1.5 });
const cube = ctx.createMesh(vertices, indices);

function render() {
  camera.write();
  const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);
    camera.bind(frame.pass, cameraBG, 0);
    cube.draw(frame.pass);
    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

### Animated (orbiting) camera

```js
let angle = 0;
function render() {
  angle += 0.005;
  const R = 3;
  camera.lookAt([Math.cos(angle) * R, 1.5, Math.sin(angle) * R], [0, 0, 0]);
  camera.write();
  // ... render ...
  requestAnimationFrame(render);
}
```

### Handling resize

Recompute the projection with the new aspect ratio:

```js
addEventListener("resize", () => {
  ctx.resize(window.innerWidth, window.innerHeight);
  camera.perspective(45, ctx.width / ctx.height, 0.01, 100);
});
```

See the **primitives** and **instanced_rendering** examples for full working pages.
For the matrix conventions behind the camera, see the
[Procedural Geometry](../guides/procedural-geometry.md) guide; for the GPU buffer, see
[Buffer](buffer.md); for building the bind group, see [Shader](shader.md).
