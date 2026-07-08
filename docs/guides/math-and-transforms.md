# Using Math & Transforms

jgfx ships a tiny `math` module — `mat4`, `vec3`, and angle helpers — so you can build
camera and model matrices without pulling in a dependency. This guide walks through it by
example: angles, vectors, model matrices, a full model-view-projection (MVP), driving a
[`Camera`](../api/camera.md), an orbiting camera, and 2D orthographic rendering. For the
exhaustive per-function list, see the [Math API reference](../api/math.md).

## The four rules

Everything in this guide rests on four conventions. They're worth memorizing:

1. **Column-major.** A matrix is a `Float32Array(16)` laid out exactly like WGSL's
   `mat4x4<f32>`, so it uploads to a uniform with **no transpose**.
2. **Left-handed.** `+Z` points into the screen after the view transform. A camera looks
   along `normalize(center - eye)`.
3. **Depth `[0, 1]`.** Clip-space depth runs 0→1, not OpenGL's −1→1.
4. **Radians.** Every angle is radians — convert with `math.radians(deg)`.

```js
import { math } from "../../jgfx/index.js";
const { mat4, vec3, radians } = math;
```

Every `mat4`/`vec3` function returns a **new** value and never mutates its arguments, so
you can compose freely without worrying about aliasing.

## Angles

Trig and the matrix builders all speak radians; humans think in degrees. Convert at the
boundary:

```js
const model = mat4.rotationY(radians(30)); // 30° about Y
const fovy = radians(45); // for mat4.perspective
```

`math.degrees(rad)` goes the other way — handy for debugging or displaying an angle.

## Vectors

`vec3` operates on plain `[x, y, z]` arrays. The workhorses are direction, distance, and
building an orthonormal basis:

```js
// Unit direction from the camera to a target.
const forward = vec3.normalize(vec3.sub(target, eye));

// Distance between two points.
const dist = vec3.length(vec3.sub(a, b));

// A "right" vector perpendicular to forward and world-up.
const right = vec3.normalize(vec3.cross([0, 1, 0], forward));
```

`normalize` is safe on a zero vector — it returns `[0, 0, 0]` rather than `NaN`. All of
`add`, `sub`, `scale`, `dot`, `cross`, `length`, and `normalize` are available.

## Building a model matrix

A model matrix places an object in the world. Build it by composing translation, rotation,
and scale with `mat4.multiply`. The key rule: **`multiply(A, B)` applies `B` first, then
`A`** — read a chain right-to-left.

```js
// Scale → rotate → translate (the standard order for a rigid object).
const model = mat4.multiply(
  mat4.translation(2, 0, 0),
  mat4.multiply(mat4.rotationY(radians(30)), mat4.scaling(0.5, 0.5, 0.5)),
);
```

That reads: shrink to half size, spin 30° about Y, then move +2 on X. Swap the order and
you get a very different result — translating *before* rotating sweeps the object around the
origin like a moon, which is exactly how you build an orbit if you want one.

## A full MVP (no Camera)

The simplest way to get 3D on screen is one uniform holding the combined
projection · view · model matrix. This is what the **textured_quad** example does:

```wgsl
struct U { mvp : mat4x4f };
@group(0) @binding(0) var<uniform> u : U;

@vertex fn vs_main(@location(0) position : vec3f) -> @builtin(position) vec4f {
  return u.mvp * vec4f(position, 1.0);
}
```

```js
const mvp = ctx.createUniform(shader, 0, new Float32Array(16)); // 16 floats = one mat4

let t = 0;
function render() {
  t += 0.016;

  // proj · view · model — remember multiply applies its right argument first.
  const proj = mat4.perspective(radians(45), ctx.width / ctx.height, 0.1, 100);
  const view = mat4.lookAt([0, 0, -3], [0, 0, 0], [0, 1, 0]); // eye on -Z, looking +Z
  const model = mat4.rotationY(t * 0.7);

  mvp.data.set(mat4.multiply(proj, mat4.multiply(view, model)));
  mvp.write();

  const frame = ctx.beginFrame([0.08, 0.08, 0.12, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);
    frame.pass.setBindGroup(0, mvp.bindGroup);
    mesh.draw(frame.pass);
    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

Note the eye sits at `-Z` looking toward the origin: because the space is **left-handed**,
`normalize(center - eye)` points in `+Z`, so the camera faces into the screen and the object
at the origin is in front of it.

## Using a Camera

Once more than one object shares a view, stop rebuilding proj·view per object and let
[`Camera`](../api/camera.md) own them. It keeps projection and view back-to-back in one
128-byte uniform (`mat4x4f` × 2), leaving each object to supply only its own model matrix.

```wgsl
struct Camera { projection : mat4x4f, view : mat4x4f };
struct Object { model : mat4x4f };
@group(0) @binding(0) var<uniform> camera : Camera;
@group(1) @binding(0) var<uniform> object : Object;

@vertex fn vs_main(@location(0) position : vec3f) -> @builtin(position) vec4f {
  return camera.projection * camera.view * object.model * vec4f(position, 1.0);
}
```

```js
const camera = ctx.createCamera({ fovy: 45, eye: [0, 3, -8], center: [0, 0, 0] });
const cameraBG = shader.createBindGroupBuffers(0, [camera.buffer]);

const object = ctx.createUniform(shader, 1, new Float32Array(16));

function render() {
  camera.write(); // upload proj+view (only needed when they change)

  const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);
    camera.bind(frame.pass, cameraBG, 0);

    object.data.set(mat4.translation(0, 0, 0)); // this object's transform
    object.write();
    frame.pass.setBindGroup(1, object.bindGroup);
    mesh.draw(frame.pass);

    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
```

`Camera` takes `fovy` in **degrees** (it converts internally) and computes aspect from
`ctx.width / ctx.height`. When you build the MVP inside a shader like this, do it left to
right (`projection * view * model`) — that's the same proj·view·model, just letting WGSL do
the multiply.

## An orbiting camera

`vec3` and `lookAt` together make camera motion easy. To orbit around a target, place the
eye on a circle and keep looking at the center:

```js
let angle = 0;
function render() {
  angle += 0.005;
  const R = 6;
  const eye = [Math.cos(angle) * R, 2.5, Math.sin(angle) * R];

  camera.lookAt(eye, [0, 0, 0]); // up defaults to [0, 1, 0]
  camera.write();
  // ... draw ...
  requestAnimationFrame(render);
}
```

For a free-fly camera, derive the movement basis from the current orientation with
`vec3.cross`: `forward = normalize(target - eye)`, `right = normalize(cross(up, forward))`,
then translate `eye` along `forward`/`right` in response to input and call `lookAt` each
frame.

## Quaternions & smooth rotation

Euler angles and rotation matrices are awkward to *interpolate* — blend two of them and you
get gimbal wobble or a shape that dents inward mid-turn. Quaternions fix that:
`quat.slerp` walks the shortest arc between two orientations at constant angular speed.

A quaternion is a plain `[x, y, z, w]` array. Build one from an axis+angle or Euler angles,
compose with `mul`, and turn it into a matrix for the GPU with `toMat4`:

```js
const { quat } = math;

const from = quat.fromEuler(0, 0, 0);
const to = quat.fromAxisAngle([0, 1, 0], radians(180));

function render(t01) {
  // t01 ramps 0 → 1; slerp gives a smooth, constant-speed turn.
  const q = quat.slerp(from, to, t01);
  object.data.set(quat.toMat4(q));
  object.write();
  // ... draw ...
}
```

For a full transform, `mat4.fromTRS` takes the quaternion directly and composes T·R·S in one
call — the usual way to place an animated object:

```js
const model = mat4.fromTRS(
  [2, 0, 0],                          // translate
  quat.fromEuler(0, t, 0),           // rotate (quaternion)
  [0.5, 0.5, 0.5],                   // scale
);
```

Quaternion and matrix rotations are consistent: `quat.toMat4(quat.fromAxisAngle(axis, θ))`
equals `mat4.rotation(θ, axis)`, so you can freely mix the two styles.

## Transforming normals

When a model matrix has **non-uniform scale**, transforming a normal by that matrix skews
it — it stops being perpendicular to the surface. The fix is the *normal matrix*: the
inverse-transpose of the model's upper-left 3×3.

```js
const nrm = mat3.normalMatrix(model); // Float32Array(9) — or null if model is singular
```

There's one WebGPU wrinkle: a WGSL `mat3x3<f32>` pads each column to 16 bytes, so a packed
9-float array won't line up in a uniform. Expand each column to a `vec4` on upload:

```js
function mat3ToStd140(m) {
  return new Float32Array([
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
  ]);
}
normalUniform.data.set(mat3ToStd140(nrm));
normalUniform.write();
```

```wgsl
@vertex fn vs_main(@location(0) position : vec3f, @location(1) normal : vec3f) -> VSOut {
  var o : VSOut;
  o.position = u.mvp * vec4f(position, 1.0);
  o.normal = normalize(u.normal * normal); // u.normal : mat3x3f
  return o;
}
```

For rigid transforms (rotation + uniform scale) you can skip all this and use the model's
3×3 directly — the inverse-transpose only matters under non-uniform scale.

## Inverting a matrix

`mat4.invert` covers the cases where you need to run a transform backwards — converting a
screen ray to world space for picking, or reading a camera's world position out of its view
matrix:

```js
const invView = mat4.invert(view);
if (invView) {
  const cameraWorldPos = mat4.getTranslation(invView);
}
```

It returns `null` for a singular matrix (e.g. one with a zero scale), so guard the result
before using it.

## Animating with easings

`lerp` and `slerp` move at constant speed, which reads as robotic. The
[`easing`](../api/easing.md) namespace shapes the *timing* so motion accelerates and settles
naturally — it's the full [easings.net](https://easings.net/) set, no library needed.

An easing takes normalized time `t ∈ [0, 1]` and returns eased progress. Drive `t` from 0→1
over the animation, ease it, then interpolate:

```js
import { math, easing } from "../../jgfx/index.js";
const { vec3, quat, clamp } = math;

const DURATION = 0.6;
let elapsed = 0;

function update(dt) {
  elapsed += dt;
  const t = clamp(elapsed / DURATION, 0, 1); // normalize + clamp
  const k = easing.easeOutCubic(t);          // shape the timing

  // Apply the eased progress to any interpolation:
  const pos = vec3.lerp(startPos, endPos, k);
  const rot = quat.slerp(startRot, endRot, k);
  object.data.set(mat4.fromTRS(pos, rot, [1, 1, 1]));
  object.write();
}
```

Swap the easing to change the feel with no other code change — `easeOutBack` gives a playful
overshoot, `easeOutElastic` a springy settle, `easeOutBounce` a drop-and-bounce. Two things
to keep in mind:

- **Clamp `t` before easing.** Easings assume `[0, 1]`; a timer that overshoots will make
  `expo`/`back`/`elastic` extrapolate wildly.
- **`back` and `elastic` overshoot on purpose** — they leave `[0, 1]` in the middle (that's
  the effect). Don't clamp the *output* unless you want to remove it.

See the [Easing reference](../api/easing.md) for the full list and a picker.

## 2D and UI: orthographic projection

Not everything is a perspective scene. `mat4.ortho` gives a flat projection — perfect for
HUDs, sprites, and debug overlays. A common setup maps clip space to **pixel coordinates**
with the origin at the top-left:

```js
// (0,0) at top-left, (width, height) at bottom-right.
const proj = mat4.ortho(0, ctx.width, ctx.height, 0, -1, 1);
```

Now a quad at pixel positions renders where you'd expect, no perspective divide distorting
it. Rebuild this matrix on resize (it depends on `ctx.width` / `ctx.height`). Because
depth is `[0, 1]`, the `near`/`far` of `-1`/`1` gives you a comfortable range for a `z`
"layer" per sprite if you enable depth testing.

## Uploading, and a note on performance

Matrices are column-major `Float32Array`s, so they drop straight into a uniform with no
transpose — that's the whole point of the layout. Two patterns:

```js
// Into a Uniform's backing array:
mvp.data.set(mat4.multiply(proj, mat4.multiply(view, model)));
mvp.write();

// Or straight to any GPU buffer:
ctx.queue.writeBuffer(someBuffer.buffer, 0, model);
```

Every `mat4` call allocates a fresh `Float32Array(16)`. That's fine for a handful of
objects per frame. If you animate thousands, precompute the matrices that don't change
(projection rarely does) and reuse them rather than rebuilding every frame — hoist `proj`
out of the render loop and only recompute it on resize.

## Common pitfalls

- **Multiply order.** `multiply(A, B)` applies `B` first. Build MVP as
  `multiply(proj, multiply(view, model))`, or in WGSL as `proj * view * model`.
- **Degrees vs radians.** `mat4.perspective`/`rotation*` want radians; `Camera` wants
  degrees. Mixing them gives a wildly wrong field of view or spin speed. Use
  `radians()` at the call site.
- **Left-handed surprises.** `+Z` goes into the screen. If your scene looks mirrored or
  inside-out, check eye/center (forward is `center - eye`) before blaming winding — and see
  the [winding note](procedural-geometry.md#winding-why-the-triangles-look-backwards) for
  the culling side of the story.
- **`lookAt` degenerate up.** `up` must not be parallel to `center - eye`, or the basis
  collapses. For a camera looking straight down, use an `up` of `[0, 0, 1]` instead of
  `[0, 1, 0]`.
- **`mat3` uniforms need padding.** A WGSL `mat3x3<f32>` pads each column to 16 bytes — upload
  a normal matrix as 3 × `vec4` (see [Transforming normals](#transforming-normals)), not a
  raw 9-float array.
- **`invert` returns `null`.** `mat4.invert` / `mat3.invert` / `mat3.normalMatrix` return
  `null` for a singular matrix (e.g. a zero scale). Guard the result before using it.

## See also

- [Math API reference](../api/math.md) — every `mat4` / `vec3` function.
- [Camera](../api/camera.md) — projection + view in one uniform.
- [Procedural Geometry](procedural-geometry.md) — feeding the math into meshes.
- The **textured_quad**, **primitives**, and **projection_matrices** examples.
