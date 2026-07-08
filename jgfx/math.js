/**
 * math.js — a small matrix/vector/quaternion library for jgfx. No dependency;
 * replaces cglm (which cgfx builds with CGLM_FORCE_LEFT_HANDED +
 * CGLM_FORCE_DEPTH_ZERO_TO_ONE) and gl-matrix.
 *
 * Conventions — chosen to match cgfx/cglm exactly, and to upload straight to
 * the GPU with no fixups:
 *
 *   • Matrices are Float32Array in COLUMN-MAJOR order (mat4 = 16 floats,
 *     mat3 = 9). Element (row r, col c) lives at index `c * rows + r`. This is
 *     cglm's in-memory layout and exactly what WGSL's `mat4x4<f32>` /
 *     `mat3x3<f32>` expect, so a matrix uploads with no transpose.
 *
 *   • Left-handed coordinate system: +Z points away from the viewer (into the
 *     screen) after the view transform. `lookAt`'s forward axis is
 *     normalize(center - eye).
 *
 *   • Clip-space depth is [0, 1] (WebGPU/D3D/Vulkan), NOT OpenGL's [-1, 1].
 *
 *   • Angles are RADIANS. Use `radians(deg)` to convert; `Camera` takes degrees
 *     for readability and converts internally (as cgfx does).
 *
 * Vectors are plain arrays ([x, y] / [x, y, z] / [x, y, z, w]); quaternions are
 * plain [x, y, z, w] arrays. Vector/quat functions return fresh arrays and never
 * mutate their inputs; matrix functions return a fresh Float32Array. Rotation
 * math reuses the standard gl-matrix formulas, so quats, `mat4.rotation`, and
 * the axis builders (`rotationX/Y/Z`) are all mutually consistent.
 */

/* --------------------------------------------------------------- scalars -- */

export const radians = (deg) => (deg * Math.PI) / 180;
export const degrees = (rad) => (rad * 180) / Math.PI;

/** Clamp `x` to the inclusive range [lo, hi]. */
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Linear interpolation: a at t=0, b at t=1. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** GLSL-style alias for {@link lerp}. */
export const mix = lerp;

/* ------------------------------------------------------------------ vec2 -- */

export const vec2 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  scale: (a, s) => [a[0] * s, a[1] * s],
  mul: (a, b) => [a[0] * b[0], a[1] * b[1]],
  div: (a, b) => [a[0] / b[0], a[1] / b[1]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  negate: (a) => [-a[0], -a[1]],
  length: (a) => Math.hypot(a[0], a[1]),
  sqrLen: (a) => a[0] * a[0] + a[1] * a[1],
  distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  min: (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  max: (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  clamp: (a, lo, hi) => [clamp(a[0], lo, hi), clamp(a[1], lo, hi)],
  normalize(a) {
    const len = Math.hypot(a[0], a[1]);
    if (len === 0) return [0, 0];
    const inv = 1 / len;
    return [a[0] * inv, a[1] * inv];
  },
};

/* ------------------------------------------------------------------ vec3 -- */

export const vec3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  div: (a, b) => [a[0] / b[0], a[1] / b[1], a[2] / b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  negate: (a) => [-a[0], -a[1], -a[2]],

  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],

  length: (a) => Math.hypot(a[0], a[1], a[2]),
  sqrLen: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
  distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),

  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],

  min: (a, b) => [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
  ],
  max: (a, b) => [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ],
  clamp: (a, lo, hi) => [
    clamp(a[0], lo, hi),
    clamp(a[1], lo, hi),
    clamp(a[2], lo, hi),
  ],

  normalize(a) {
    const len = Math.hypot(a[0], a[1], a[2]);
    if (len === 0) return [0, 0, 0];
    const inv = 1 / len;
    return [a[0] * inv, a[1] * inv, a[2] * inv];
  },

  /**
   * Transform a point by a mat4 (treats `a` as [x, y, z, 1] and divides by the
   * resulting w, so perspective matrices project correctly). For directions or
   * normals use a normal matrix instead — see {@link mat3.normalMatrix}.
   */
  transformMat4(a, m) {
    const x = a[0], y = a[1], z = a[2];
    let w = m[3] * x + m[7] * y + m[11] * z + m[15];
    w = w || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  },
};

/* ------------------------------------------------------------------ vec4 -- */

export const vec4 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s, a[3] * s],
  mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]],
  div: (a, b) => [a[0] / b[0], a[1] / b[1], a[2] / b[2], a[3] / b[3]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
  negate: (a) => [-a[0], -a[1], -a[2], -a[3]],
  length: (a) => Math.hypot(a[0], a[1], a[2], a[3]),
  sqrLen: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3],
  distance: (a, b) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]),
  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ],
  min: (a, b) => [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ],
  max: (a, b) => [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ],
  clamp: (a, lo, hi) => [
    clamp(a[0], lo, hi),
    clamp(a[1], lo, hi),
    clamp(a[2], lo, hi),
    clamp(a[3], lo, hi),
  ],
  normalize(a) {
    const len = Math.hypot(a[0], a[1], a[2], a[3]);
    if (len === 0) return [0, 0, 0, 0];
    const inv = 1 / len;
    return [a[0] * inv, a[1] * inv, a[2] * inv, a[3] * inv];
  },
};

/* ------------------------------------------------------------------ mat3 -- */

export const mat3 = {
  /** New 3×3 identity matrix (column-major Float32Array). */
  identity() {
    const m = new Float32Array(9);
    m[0] = m[4] = m[8] = 1;
    return m;
  },

  /** Extract the upper-left 3×3 of a mat4 (drops translation). */
  fromMat4(a) {
    const m = new Float32Array(9);
    m[0] = a[0]; m[1] = a[1]; m[2] = a[2];
    m[3] = a[4]; m[4] = a[5]; m[5] = a[6];
    m[6] = a[8]; m[7] = a[9]; m[8] = a[10];
    return m;
  },

  /** Transpose a 3×3. */
  transpose(a) {
    const m = new Float32Array(9);
    m[0] = a[0]; m[1] = a[3]; m[2] = a[6];
    m[3] = a[1]; m[4] = a[4]; m[5] = a[7];
    m[6] = a[2]; m[7] = a[5]; m[8] = a[8];
    return m;
  },

  /** Matrix product a·b (applies b first, then a). */
  multiply(a, b) {
    const out = new Float32Array(9);
    for (let c = 0; c < 3; c++) {
      const b0 = b[c * 3], b1 = b[c * 3 + 1], b2 = b[c * 3 + 2];
      out[c * 3] = b0 * a[0] + b1 * a[3] + b2 * a[6];
      out[c * 3 + 1] = b0 * a[1] + b1 * a[4] + b2 * a[7];
      out[c * 3 + 2] = b0 * a[2] + b1 * a[5] + b2 * a[8];
    }
    return out;
  },

  /** Inverse of a 3×3, or `null` if it is singular (determinant 0). */
  invert(a) {
    const a00 = a[0], a01 = a[1], a02 = a[2];
    const a10 = a[3], a11 = a[4], a12 = a[5];
    const a20 = a[6], a21 = a[7], a22 = a[8];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) return null;
    det = 1 / det;
    const m = new Float32Array(9);
    m[0] = b01 * det;
    m[1] = (-a22 * a01 + a02 * a21) * det;
    m[2] = (a12 * a01 - a02 * a11) * det;
    m[3] = b11 * det;
    m[4] = (a22 * a00 - a02 * a20) * det;
    m[5] = (-a12 * a00 + a02 * a10) * det;
    m[6] = b21 * det;
    m[7] = (-a21 * a00 + a01 * a20) * det;
    m[8] = (a11 * a00 - a01 * a10) * det;
    return m;
  },

  /**
   * Normal matrix from a mat4 model transform: the inverse-transpose of its
   * upper-left 3×3, for transforming normals under non-uniform scale. Returns
   * `null` if the model matrix is singular. Upload as a `mat3x3<f32>`.
   */
  normalMatrix(a) {
    const inv = mat3.invert(mat3.fromMat4(a));
    return inv && mat3.transpose(inv);
  },
};

/* ------------------------------------------------------------------ mat4 -- */

export const mat4 = {
  /** New 4×4 identity matrix (column-major Float32Array). */
  identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  /** Copy of a 4×4. */
  clone(a) {
    return new Float32Array(a);
  },

  /**
   * Matrix product a·b (both column-major). Result column j = a · (col j of b),
   * i.e. applying b's transform first, then a's — the usual convention, so
   * `multiply(projection, multiply(view, model))` is proj·view·model.
   */
  multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = sum;
      }
    }
    return out;
  },

  /** Transpose a 4×4. */
  transpose(a) {
    const m = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) m[c * 4 + r] = a[r * 4 + c];
    }
    return m;
  },

  /** Determinant of a 4×4. */
  determinant(a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  },

  /** Inverse of a 4×4, or `null` if it is singular (determinant 0). */
  invert(a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det =
      b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    const m = new Float32Array(16);
    m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return m;
  },

  /**
   * Perspective projection, left-handed, depth [0, 1]
   * (= cglm glm_perspective_lh_zo). `fovy` is the vertical field of view in
   * RADIANS; `aspect` is width / height.
   */
  perspective(fovy, aspect, near, far) {
    const m = new Float32Array(16);
    const f = 1 / Math.tan(fovy / 2);
    const fn = 1 / (near - far);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = -far * fn;
    m[11] = 1;
    m[14] = near * far * fn;
    return m;
  },

  /**
   * Orthographic projection, left-handed, depth [0, 1]
   * (= cglm glm_ortho_lh_zo).
   */
  ortho(left, right, bottom, top, near, far) {
    const m = new Float32Array(16);
    const rl = 1 / (right - left);
    const tb = 1 / (top - bottom);
    const fn = -1 / (far - near);
    m[0] = 2 * rl;
    m[5] = 2 * tb;
    m[10] = -fn;
    m[12] = -(right + left) * rl;
    m[13] = -(top + bottom) * tb;
    m[14] = near * fn;
    m[15] = 1;
    return m;
  },

  /**
   * View matrix, left-handed (= cglm glm_lookat_lh). `up` need not be
   * normalized but must not be parallel to (center - eye).
   */
  lookAt(eye, center, up) {
    const f = vec3.normalize(vec3.sub(center, eye)); // forward (+Z, left-handed)
    const s = vec3.normalize(vec3.cross(up, f)); // right
    const u = vec3.cross(f, s); // true up (already unit)

    const m = new Float32Array(16);
    m[0] = s[0]; m[1] = u[0]; m[2] = f[0]; m[3] = 0;
    m[4] = s[1]; m[5] = u[1]; m[6] = f[1]; m[7] = 0;
    m[8] = s[2]; m[9] = u[2]; m[10] = f[2]; m[11] = 0;
    m[12] = -vec3.dot(s, eye);
    m[13] = -vec3.dot(u, eye);
    m[14] = -vec3.dot(f, eye);
    m[15] = 1;
    return m;
  },

  /* -- model-transform builders (convenience for examples) --------------- */

  /** Translation matrix. */
  translation(x, y, z) {
    const m = mat4.identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },

  /** Non-uniform scale matrix. */
  scaling(x, y, z) {
    const m = new Float32Array(16);
    m[0] = x; m[5] = y; m[10] = z; m[15] = 1;
    return m;
  },

  /** Rotation about the X axis (radians). */
  rotationX(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = mat4.identity();
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  },

  /** Rotation about the Y axis (radians). */
  rotationY(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = mat4.identity();
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  },

  /** Rotation about the Z axis (radians). */
  rotationZ(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = mat4.identity();
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
    return m;
  },

  /**
   * Rotation of `angle` radians about an arbitrary `axis` [x, y, z]
   * (Rodrigues' formula). The axis is normalized for you; a zero-length axis
   * yields identity. Reduces to rotationX/Y/Z for the basis axes.
   */
  rotation(angle, axis) {
    const [x, y, z] = vec3.normalize(axis);
    if (x === 0 && y === 0 && z === 0) return mat4.identity();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const m = new Float32Array(16);
    m[0] = x * x * t + c;
    m[1] = y * x * t + z * s;
    m[2] = z * x * t - y * s;
    m[4] = x * y * t - z * s;
    m[5] = y * y * t + c;
    m[6] = z * y * t + x * s;
    m[8] = x * z * t + y * s;
    m[9] = y * z * t - x * s;
    m[10] = z * z * t + c;
    m[15] = 1;
    return m;
  },

  /**
   * Compose a transform from translation, rotation (a quaternion), and scale:
   * T · R · S. Equivalent to
   * `multiply(translation(...t), multiply(quat.toMat4(r), scaling(...s)))`.
   * @param {number[]} t translation [x, y, z]
   * @param {number[]} r rotation quaternion [x, y, z, w]
   * @param {number[]} s scale [x, y, z]
   */
  fromTRS(t, r, s) {
    const x = r[0], y = r[1], z = r[2], w = r[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = s[0], sy = s[1], sz = s[2];
    const m = new Float32Array(16);
    m[0] = (1 - (yy + zz)) * sx;
    m[1] = (xy + wz) * sx;
    m[2] = (xz - wy) * sx;
    m[3] = 0;
    m[4] = (xy - wz) * sy;
    m[5] = (1 - (xx + zz)) * sy;
    m[6] = (yz + wx) * sy;
    m[7] = 0;
    m[8] = (xz + wy) * sz;
    m[9] = (yz - wx) * sz;
    m[10] = (1 - (xx + yy)) * sz;
    m[11] = 0;
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    return m;
  },

  /** Extract the translation component [x, y, z] of a 4×4. */
  getTranslation(a) {
    return [a[12], a[13], a[14]];
  },
};

/* ------------------------------------------------------------------ quat -- */

/**
 * Unit quaternions as [x, y, z, w] arrays. Consistent with the matrix builders:
 * `quat.toMat4` and `mat4.rotation` produce the same rotation for the same
 * axis/angle. Use quaternions when you need to interpolate rotations smoothly
 * (see {@link quat.slerp}).
 */
export const quat = {
  /** Identity quaternion (no rotation). */
  identity: () => [0, 0, 0, 1],

  /** Quaternion for `angle` radians about `axis` [x, y, z] (axis normalized). */
  fromAxisAngle(axis, angle) {
    const [x, y, z] = vec3.normalize(axis);
    const h = angle * 0.5;
    const s = Math.sin(h);
    return [x * s, y * s, z * s, Math.cos(h)];
  },

  /**
   * Quaternion from Euler angles in RADIANS, applied intrinsically X→Y→Z
   * (equivalent to `mul(fromAxisAngle(Z,z), mul(fromAxisAngle(Y,y), fromAxisAngle(X,x)))`).
   */
  fromEuler(x, y, z) {
    const qx = quat.fromAxisAngle([1, 0, 0], x);
    const qy = quat.fromAxisAngle([0, 1, 0], y);
    const qz = quat.fromAxisAngle([0, 0, 1], z);
    return quat.mul(qz, quat.mul(qy, qx));
  },

  /** Hamilton product a⊗b — applies b's rotation first, then a's. */
  mul(a, b) {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3];
    const bx = b[0], by = b[1], bz = b[2], bw = b[3];
    return [
      ax * bw + aw * bx + ay * bz - az * by,
      ay * bw + aw * by + az * bx - ax * bz,
      az * bw + aw * bz + ax * by - ay * bx,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  },

  /** Normalize to a unit quaternion (returns identity for a zero quaternion). */
  normalize(q) {
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    if (len === 0) return [0, 0, 0, 1];
    const inv = 1 / len;
    return [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv];
  },

  /**
   * Spherical linear interpolation from a to b by t ∈ [0, 1], along the
   * shortest arc. Falls back to linear blending when the quaternions are nearly
   * parallel. Inputs should be unit quaternions.
   */
  slerp(a, b, t) {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3];
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    let cosom = ax * bx + ay * by + az * bz + aw * bw;
    if (cosom < 0) {
      cosom = -cosom;
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    let scale0, scale1;
    if (1 - cosom > 1e-6) {
      const omega = Math.acos(cosom);
      const sinom = Math.sin(omega);
      scale0 = Math.sin((1 - t) * omega) / sinom;
      scale1 = Math.sin(t * omega) / sinom;
    } else {
      scale0 = 1 - t;
      scale1 = t;
    }
    return [
      scale0 * ax + scale1 * bx,
      scale0 * ay + scale1 * by,
      scale0 * az + scale1 * bz,
      scale0 * aw + scale1 * bw,
    ];
  },

  /** Rotation matrix (mat4, column-major) for this quaternion. */
  toMat4(q) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, yx = y * x2, yy = y * y2;
    const zx = z * x2, zy = z * y2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const m = new Float32Array(16);
    m[0] = 1 - yy - zz; m[1] = yx + wz; m[2] = zx - wy; m[3] = 0;
    m[4] = yx - wz; m[5] = 1 - xx - zz; m[6] = zy + wx; m[7] = 0;
    m[8] = zx + wy; m[9] = zy - wx; m[10] = 1 - xx - yy; m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
  },
};
