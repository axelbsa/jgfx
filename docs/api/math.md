# Math

A small matrix / vector / quaternion library — enough for real graphics work, with no
external dependency.

**File:** `math.js`

jgfx ships its own math instead of pulling in gl-matrix. It replaces cgfx's use of
[cglm](https://github.com/recp/cglm) and matches that build's conventions exactly
(`CGLM_FORCE_LEFT_HANDED` + `CGLM_FORCE_DEPTH_ZERO_TO_ONE`), so ported matrices are
numerically identical. Rotation math follows the standard gl-matrix formulas, so quaternions,
`mat4.rotation`, and the axis builders (`rotationX/Y/Z`) are all mutually consistent.

Import it as a namespace (the whole module) or cherry-pick:

```js
import { math } from "./jgfx/index.js";
const { mat4, mat3, vec3, quat, radians } = math;

// or straight from the file:
import { vec2, vec3, vec4, mat3, mat4, quat, radians, clamp, lerp } from "./jgfx/math.js";
```

---

## Conventions

These rules hold everywhere in jgfx — read them once and the rest follows.

| Rule | Detail |
|------|--------|
| **Column-major** | A `mat4` is a `Float32Array(16)`, a `mat3` a `Float32Array(9)`. Element (row `r`, col `c`) is at index `c * rows + r` — exactly what WGSL's `mat4x4<f32>` / `mat3x3<f32>` expect. |
| **Left-handed** | `+Z` points *away* from the viewer (into the screen) after the view transform. `lookAt`'s forward axis is `normalize(center - eye)`. |
| **Depth `[0, 1]`** | Clip-space depth runs `0`→`1` (WebGPU / D3D / Vulkan), **not** OpenGL's `[-1, 1]`. |
| **Radians** | All angles are radians. Use [`radians()`](#radians-degrees) to convert. `Camera` takes degrees for readability and converts internally. |

Vectors are plain arrays — `[x, y]`, `[x, y, z]`, `[x, y, z, w]` — and quaternions are plain
`[x, y, z, w]` arrays. Every `vec`/`quat` function returns a fresh array; every matrix
function returns a fresh `Float32Array`. **Nothing mutates its inputs**, so you can compose
freely.

!!! warning "`mat3` uniforms need padded columns"
    A WGSL `mat3x3<f32>` pads each column to 16 bytes (48 bytes total), so a tight
    `Float32Array(9)` (36 bytes) will **not** upload correctly to a `mat3x3f` uniform. See
    [Uploading to the GPU](#uploading-to-the-gpu) for the pad-to-`vec4` pattern.

---

## Scalars

### radians / degrees

Convert between degrees and radians.

```js
math.radians(180); // 3.14159…
math.degrees(Math.PI); // 180
```

### clamp / lerp / mix

| Function | Signature | Description |
|----------|-----------|-------------|
| `clamp` | `clamp(x, lo, hi)` | Constrain `x` to `[lo, hi]`. |
| `lerp` | `lerp(a, b, t)` | Linear interpolation: `a` at `t=0`, `b` at `t=1`. |
| `mix` | `mix(a, b, t)` | GLSL-style alias for `lerp`. |

---

## Vectors — vec2, vec3, vec4

All three share the same API, operating on plain arrays and returning fresh arrays. Only the
component count differs. `vec3` adds `cross` and `transformMat4`.

| Function | Signature | Description |
|----------|-----------|-------------|
| `add` / `sub` | `add(a, b)` | Component-wise sum / difference. |
| `mul` / `div` | `mul(a, b)` | Component-wise product / quotient. |
| `scale` | `scale(a, s)` | Multiply by scalar `s`. |
| `negate` | `negate(a)` | `-a`. |
| `dot` | `dot(a, b)` | Dot product → `number`. |
| `length` | `length(a)` | Euclidean length → `number`. |
| `sqrLen` | `sqrLen(a)` | Squared length (cheaper — no `sqrt`). |
| `distance` | `distance(a, b)` | Distance between two points. |
| `normalize` | `normalize(a)` | Unit vector; returns a zero vector for zero input (no `NaN`). |
| `lerp` | `lerp(a, b, t)` | Component-wise linear interpolation. |
| `min` / `max` | `min(a, b)` | Component-wise minimum / maximum (handy for AABBs). |
| `clamp` | `clamp(a, lo, hi)` | Clamp every component to the scalar range `[lo, hi]`. |

**vec3 only:**

| Function | Signature | Description |
|----------|-----------|-------------|
| `cross` | `cross(a, b)` | Cross product `a × b`. |
| `transformMat4` | `transformMat4(a, m)` | Transform a **point** by a mat4 (treats `a` as `[x,y,z,1]` and divides by the resulting `w`, so perspective projects correctly). For normals, use [`mat3.normalMatrix`](#mat3). |

```js
const forward = vec3.normalize(vec3.sub(target, eye));
const right = vec3.normalize(vec3.cross([0, 1, 0], forward));
const midpoint = vec3.lerp(a, b, 0.5);
const clipPoint = vec3.transformMat4(worldPoint, mvp);
```

---

## mat4

Column-major `Float32Array(16)`. Every function returns a fresh matrix.

### Construction & queries

| Function | Signature | Description |
|----------|-----------|-------------|
| `identity` | `identity()` | Identity matrix. |
| `clone` | `clone(a)` | Copy of `a`. |
| `multiply` | `multiply(a, b)` | Product `a · b` — applies **`b` first, then `a`**. |
| `transpose` | `transpose(a)` | Transpose. |
| `determinant` | `determinant(a)` | Determinant → `number`. |
| `invert` | `invert(a)` | Inverse, or **`null`** if `a` is singular (determinant 0). |
| `getTranslation` | `getTranslation(a)` | The translation column → `[x, y, z]`. |

!!! warning "`invert` can return null"
    `mat4.invert` returns `null` for a non-invertible matrix. Guard the result before use if
    the input might be singular (e.g. a zero scale).

### Projection & view

| Function | Signature | Description |
|----------|-----------|-------------|
| `perspective` | `perspective(fovy, aspect, near, far)` | Perspective, left-handed, depth `[0,1]`. `fovy` in **radians**. |
| `ortho` | `ortho(left, right, bottom, top, near, far)` | Orthographic, left-handed, depth `[0,1]`. |
| `lookAt` | `lookAt(eye, center, up)` | View matrix, left-handed. `up` must not be parallel to `center - eye`. |

### Model-transform builders

| Function | Signature | Description |
|----------|-----------|-------------|
| `translation` | `translation(x, y, z)` | Translation matrix. |
| `scaling` | `scaling(x, y, z)` | Non-uniform scale. |
| `rotationX/Y/Z` | `rotationY(a)` | Rotation about a basis axis, `a` in **radians**. |
| `rotation` | `rotation(angle, axis)` | Rotation of `angle` radians about an arbitrary `axis` `[x,y,z]` (normalized for you; zero axis → identity). Reduces to `rotationX/Y/Z` for the basis axes. |
| `fromTRS` | `fromTRS(t, r, s)` | Compose `T · R · S` from a translation `[x,y,z]`, a rotation **quaternion** `[x,y,z,w]`, and a scale `[x,y,z]`. |

```js
// proj · view · model
const mvp = mat4.multiply(proj, mat4.multiply(view, model));

// Arbitrary-axis spin:
const tilt = mat4.rotation(radians(30), vec3.normalize([1, 1, 0]));

// TRS straight from a quaternion:
const model = mat4.fromTRS([2, 0, 0], quat.fromEuler(0, t, 0), [1, 1, 1]);
```

---

## mat3

Column-major `Float32Array(9)`. Useful mainly for **normal matrices**.

| Function | Signature | Description |
|----------|-----------|-------------|
| `identity` | `identity()` | Identity matrix. |
| `fromMat4` | `fromMat4(a)` | Upper-left 3×3 of a mat4 (drops translation). |
| `transpose` | `transpose(a)` | Transpose. |
| `multiply` | `multiply(a, b)` | Product `a · b` (applies `b` first). |
| `invert` | `invert(a)` | Inverse, or **`null`** if singular. |
| `normalMatrix` | `normalMatrix(a)` | Normal matrix from a **mat4** model transform: the inverse-transpose of its upper-left 3×3, for transforming normals under non-uniform scale. Returns `null` if `a` is singular. |

```js
const nrm = mat3.normalMatrix(model); // Float32Array(9), or null
```

!!! note "When do I need a normal matrix?"
    For rigid transforms (rotation + uniform scale + translation) you can transform normals
    with the model matrix's 3×3 directly. Only **non-uniform** scale requires the
    inverse-transpose — otherwise normals come out skewed. See
    [Uploading to the GPU](#uploading-to-the-gpu) for the `mat3x3f` padding caveat.

---

## quat

Unit quaternions as `[x, y, z, w]` arrays. Reach for quaternions when you need to
**interpolate rotations smoothly** — `slerp` has none of the gimbal or blending artifacts of
interpolating Euler angles or matrices.

| Function | Signature | Description |
|----------|-----------|-------------|
| `identity` | `identity()` | `[0, 0, 0, 1]` — no rotation. |
| `fromAxisAngle` | `fromAxisAngle(axis, angle)` | From an axis `[x,y,z]` and `angle` in **radians** (axis normalized for you). |
| `fromEuler` | `fromEuler(x, y, z)` | From Euler angles in **radians**, applied intrinsically X→Y→Z. |
| `mul` | `mul(a, b)` | Hamilton product `a⊗b` — applies `b`'s rotation first, then `a`'s. |
| `normalize` | `normalize(q)` | Renormalize to unit length (returns identity for a zero quaternion). |
| `slerp` | `slerp(a, b, t)` | Spherical linear interpolation along the shortest arc, `t ∈ [0, 1]`. |
| `toMat4` | `toMat4(q)` | Rotation matrix (`Float32Array(16)`) for the quaternion. |

```js
const a = quat.fromEuler(0, 0, 0);
const b = quat.fromAxisAngle([0, 1, 0], radians(180));

// Smoothly rotate a→b and feed the result to the GPU as a matrix:
const model = quat.toMat4(quat.slerp(a, b, t));
```

!!! tip "Consistency with the matrix builders"
    `quat.toMat4(quat.fromAxisAngle(axis, θ))` equals `mat4.rotation(θ, axis)`, and both
    reduce to `rotationX/Y/Z` on the basis axes — so you can mix quaternion and matrix code
    without surprises.

---

## Uploading to the GPU

`mat4` and vectors are already laid out the way WGSL wants, so they upload with no fixups.

```js
// A mat4 → a mat4x4f uniform (64 bytes), no transpose:
mvp.data.set(mat4.multiply(proj, mat4.multiply(view, model)));
mvp.write();
```

**`mat3` is the exception.** A WGSL `mat3x3<f32>` aligns each column to 16 bytes (48 bytes
total), so a packed `Float32Array(9)` does not match. Expand each column to a `vec4`:

```js
// mat3 (9 floats) → mat3x3f layout (3 × vec4 = 12 floats).
function mat3ToStd140(m) {
  return new Float32Array([
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
  ]);
}

const nrm = mat3.normalMatrix(model);
normalUniform.data.set(mat3ToStd140(nrm));
normalUniform.write();
```

```wgsl
struct U { model : mat4x4f, normal : mat3x3f };
@group(0) @binding(0) var<uniform> u : U;
// u.normal reads back correctly from the padded upload above.
```

---

## See also

- [Using Math & Transforms](../guides/math-and-transforms.md) — a worked guide covering
  camera, model matrices, quaternions/slerp, normal matrices, and 2D.
- [Camera](camera.md) — projection + view bundled into a GPU uniform.
- [Procedural Geometry](../guides/procedural-geometry.md) — where the math feeds meshes.
