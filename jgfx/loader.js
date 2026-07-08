/**
 * @file loader.js
 * @brief Load geometry from the LearnWebGPU bespoke text format (= cgfx_loader).
 *
 * A temporary tutorial helper — the same one cgfx ships to follow along with the
 * LearnWebGPU book. It will be replaced by a real asset format (glTF) later; do
 * not build production pipelines on it.
 *
 * These are standalone functions rather than Context methods, mirroring cgfx's
 * free `cgfx_load_*` functions and keeping the "temporary" surface out of the
 * core Context API. Fetching makes them async (the browser analogue of cgfx's
 * `fopen`); the pure parser (`parseGeometry`) is exposed too, so you can feed it
 * text from anywhere.
 *
 * File format (see any *.txt beside the examples):
 *
 *   # comments start with '#'
 *   [points]
 *   x y z r g b      # 6 floats/point, OR
 *   x y r g b        # 5 floats/point (z defaults to 0)
 *   [indices]
 *   i0 i1 i2         # one triangle per line
 */

import { Mesh } from "./mesh.js";

/**
 * Parse the text format into raw geometry (= cgfx_load_geometry, but pure and
 * synchronous — no I/O). The section is chosen by the `[points]`/`[indices]`
 * headers; `#` and blank lines are skipped. `floatsPerPoint` (5 or 6) is
 * auto-detected from the first data line in `[points]`.
 *
 * Divergence from cgfx: cgfx's `CgfxGeometry.point_count` actually counts
 * *floats*; jgfx's `pointCount` is the true number of points
 * (`pointData.length / floatsPerPoint`).
 *
 * @param {string} text
 * @returns {{pointData: Float32Array, pointCount: number, floatsPerPoint: number,
 *            indexData: Uint32Array, indexCount: number}}
 */
export function parseGeometry(text) {
  const points = [];
  const indices = [];
  let floatsPerPoint = 0;
  let section = null; // "points" | "indices" | null

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line[0] === "#") continue;
    if (line === "[points]") {
      section = "points";
      continue;
    }
    if (line === "[indices]") {
      section = "indices";
      continue;
    }

    // Split on runs of whitespace; strip any trailing inline comment.
    const hash = line.indexOf("#");
    const body = hash >= 0 ? line.slice(0, hash) : line;
    const cols = body.split(/\s+/).filter(Boolean);

    if (section === "points") {
      const v = cols.map(Number);
      if (v.length < 5 || v.some(Number.isNaN)) continue;
      if (floatsPerPoint === 0) floatsPerPoint = v.length; // 5 or 6
      // Only keep the detected width so a stray longer line can't desync packing.
      for (let i = 0; i < floatsPerPoint; i++) points.push(v[i] ?? 0);
    } else if (section === "indices") {
      const t = cols.map(Number);
      if (t.length < 3 || t.some(Number.isNaN)) continue;
      indices.push(t[0], t[1], t[2]);
    }
  }

  return {
    pointData: new Float32Array(points),
    pointCount: floatsPerPoint ? points.length / floatsPerPoint : 0,
    floatsPerPoint,
    indexData: new Uint32Array(indices),
    indexCount: indices.length,
  };
}

/**
 * Fetch a geometry text file and parse it (= the I/O half of cgfx_load_geometry).
 * @param {string} url
 * @returns {Promise<ReturnType<typeof parseGeometry>>}
 */
export async function loadGeometry(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[jgfx] failed to fetch geometry '${url}': ${res.status}`);
  }
  return parseGeometry(await res.text());
}

/**
 * Load a file and build a Mesh in one call (= cgfx_load_tutorial_mesh). Each
 * point becomes a standard vertex with position + white-alpha color:
 *   6 floats `x y z r g b` → position (x,y,z), color (r,g,b,1)
 *   5 floats `x y r g b`   → position (x,y,0), color (r,g,b,1)
 * @param {import('./context.js').Context} ctx
 * @param {string} url
 * @returns {Promise<Mesh>}
 */
export async function loadMesh(ctx, url) {
  const geo = await loadGeometry(url);
  const { pointData, pointCount, floatsPerPoint } = geo;
  const hasZ = floatsPerPoint >= 6;

  const vertices = new Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    const p = i * floatsPerPoint;
    vertices[i] = hasZ
      ? {
          position: [pointData[p], pointData[p + 1], pointData[p + 2]],
          color: [pointData[p + 3], pointData[p + 4], pointData[p + 5], 1],
        }
      : {
          position: [pointData[p], pointData[p + 1], 0],
          color: [pointData[p + 2], pointData[p + 3], pointData[p + 4], 1],
        };
  }

  return new Mesh(ctx, vertices, geo.indexData);
}
