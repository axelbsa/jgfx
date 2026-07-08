/**
 * @file geometry.js
 * @brief Procedural primitive generators (cube / plane / sphere).
 *
 * Each returns plain `{ vertices, indices }` where `vertices` is an array of
 * vertex objects ready for `new Mesh(ctx, vertices, indices)` (or
 * `ctx.createMesh`). Positions, normals and texcoord0 are filled; color is left
 * to Mesh's default (white) so you can tint in a shader.
 *
 * Winding: triangles are CW when viewed from outside *in model space*. That reads
 * backwards versus the OpenGL CCW-from-outside convention, and on purpose: WebGPU
 * resolves front/back facing in framebuffer space, whose Y axis points down, which
 * flips apparent winding. So a model-space-CW exterior face lands CCW on screen,
 * and the WebGPU-default pipeline (`frontFace:"ccw"` + `cullMode:"back"`) culls
 * the interior and shows the exterior — no per-example front-face override needed.
 */

/**
 * Axis-aligned cube centered at the origin, 24 vertices (hard per-face normals).
 * @param {{size?:number}} [opts]
 */
export function cube({ size = 1 } = {}) {
  const s = size / 2;
  // [normal, four corners listed CCW-from-outside]; the index order below emits
  // them CW-from-outside (see file header for why WebGPU wants that).
  const faces = [
    [[0, 0, 1],  [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]],
    [[0, 0, -1], [s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]],
    [[0, 1, 0],  [-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]],
    [[0, -1, 0], [-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]],
    [[1, 0, 0],  [s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]],
    [[-1, 0, 0], [-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]],
  ];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];

  const vertices = [];
  const indices = [];
  for (const [normal, ...corners] of faces) {
    const base = vertices.length;
    for (let k = 0; k < 4; k++) {
      vertices.push({ position: corners[k], normal, texcoord0: uv[k] });
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return { vertices, indices };
}

/**
 * Flat plane on the XZ ground plane, facing +Y, subdivided into a grid.
 * @param {{size?:number, segments?:number}} [opts]
 */
export function plane({ size = 1, segments = 1 } = {}) {
  const vertices = [];
  const indices = [];
  const half = size / 2;
  const step = size / segments;

  for (let z = 0; z <= segments; z++) {
    for (let x = 0; x <= segments; x++) {
      vertices.push({
        position: [-half + x * step, 0, -half + z * step],
        normal: [0, 1, 0],
        texcoord0: [x / segments, z / segments],
      });
    }
  }
  const row = segments + 1;
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * row + x;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { vertices, indices };
}

/**
 * UV sphere centered at the origin.
 * @param {{radius?:number, segments?:number, rings?:number}} [opts]
 */
export function sphere({ radius = 0.5, segments = 32, rings = 16 } = {}) {
  const vertices = [];
  const indices = [];

  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI; // 0..π (pole to pole)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const theta = u * Math.PI * 2; // 0..2π (around)
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);
      vertices.push({
        position: [nx * radius, ny * radius, nz * radius],
        normal: [nx, ny, nz],
        texcoord0: [u, v],
      });
    }
  }
  const row = segments + 1;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * row + x;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { vertices, indices };
}
