/**
 * @file mesh.js
 * @brief Mesh — vertex data + index data + GPU buffers (= cgfx_mesh).
 *
 * All meshes share one standardized 96-byte vertex so a single pipeline vertex
 * layout works everywhere. You can pass either an array of vertex objects
 * ({position, normal, color, ...}) which Mesh packs for you, or an already-
 * packed ArrayBuffer / Float32Array if you built the interleaved data yourself.
 */

import { VERTEX_SIZE } from "./constants.js";
import { Buffer } from "./buffer.js";

/**
 * The standard vertex, field → byte offset → shader location. Matches
 * CgfxVertex exactly (96 bytes, tightly packed). `count` is the element count
 * and `u16` marks the fields stored as Uint16 (everything else is Float32).
 */
const FIELDS = [
  { name: "position",  offset: 0,  count: 3, location: 0 },
  { name: "normal",    offset: 12, count: 3, location: 1 },
  { name: "tangent",   offset: 24, count: 4, location: 2 },
  { name: "texcoord0", offset: 40, count: 2, location: 3 },
  { name: "texcoord1", offset: 48, count: 2, location: 4 },
  { name: "color",     offset: 56, count: 4, location: 5 },
  { name: "joints",    offset: 72, count: 4, location: 6, u16: true },
  { name: "weights",   offset: 80, count: 4, location: 7 },
];

// Sensible per-field defaults for omitted attributes. color defaults to opaque
// white (friendlier than cgfx's zero-init black), so an untinted mesh is still
// visible; everything else defaults to zero.
const DEFAULTS = {
  position: [0, 0, 0],
  normal: [0, 0, 0],
  tangent: [0, 0, 0, 0],
  texcoord0: [0, 0],
  texcoord1: [0, 0],
  color: [1, 1, 1, 1],
  joints: [0, 0, 0, 0],
  weights: [0, 0, 0, 0],
};

export class Mesh {
  /**
   * @param {import('./context.js').Context} ctx
   * @param {Array<object>|ArrayBuffer|ArrayBufferView} vertices  vertex objects OR packed data
   * @param {number[]|Uint32Array} indices
   */
  constructor(ctx, vertices, indices) {
    this.ctx = ctx;

    const packed = Array.isArray(vertices)
      ? Mesh.packVertices(vertices)
      : vertices;
    const bytes =
      packed instanceof ArrayBuffer ? packed.byteLength : packed.byteLength;
    const vertexCount = bytes / VERTEX_SIZE;

    this.vertexBuffer = Buffer.vertex(ctx, packed, vertexCount);
    this.indexBuffer = Buffer.index(ctx, indices);
    this.indexCount = this.indexBuffer.count;
    this.ok = this.vertexBuffer.ok && this.indexBuffer.ok;
  }

  /**
   * Pack an array of vertex objects into the 96-byte interleaved layout,
   * handling the mixed Float32 / Uint16 fields. Missing fields take DEFAULTS.
   * @param {Array<object>} verts
   * @returns {ArrayBuffer}
   */
  static packVertices(verts) {
    const buffer = new ArrayBuffer(verts.length * VERTEX_SIZE);
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      const base = i * VERTEX_SIZE;
      const f32 = new Float32Array(buffer, base, VERTEX_SIZE / 4);
      const u16 = new Uint16Array(buffer, base, VERTEX_SIZE / 2);
      for (const field of FIELDS) {
        const src = v[field.name] ?? DEFAULTS[field.name];
        const view = field.u16 ? u16 : f32;
        const start = field.offset / (field.u16 ? 2 : 4);
        for (let k = 0; k < field.count; k++) view[start + k] = src[k] ?? 0;
      }
    }
    return buffer;
  }

  /**
   * The GPUVertexBufferLayout describing the standard vertex (stride 96, 8
   * attributes at locations 0–7). Pass to createPipeline's vertexLayouts.
   * @returns {GPUVertexBufferLayout}
   */
  static vertexLayout() {
    return {
      arrayStride: VERTEX_SIZE,
      stepMode: "vertex",
      attributes: FIELDS.map((f) => ({
        format: f.u16 ? "uint16x4" : `float32x${f.count}`,
        offset: f.offset,
        shaderLocation: f.location,
      })),
    };
  }

  /** Bind buffers and issue an indexed draw (= cgfx_mesh_draw). */
  draw(pass) {
    pass.setVertexBuffer(0, this.vertexBuffer.buffer, 0, this.vertexBuffer.size);
    pass.setIndexBuffer(this.indexBuffer.buffer, "uint32", 0, this.indexBuffer.size);
    pass.drawIndexed(this.indexCount, 1, 0, 0, 0);
  }

  /**
   * Indexed instanced draw (= cgfx_mesh_draw_instanced). Set the per-instance
   * vertex buffer at slot 1 (stepMode 'instance') before calling.
   */
  drawInstanced(pass, instanceCount) {
    pass.setVertexBuffer(0, this.vertexBuffer.buffer, 0, this.vertexBuffer.size);
    pass.setIndexBuffer(this.indexBuffer.buffer, "uint32", 0, this.indexBuffer.size);
    pass.drawIndexed(this.indexCount, instanceCount, 0, 0, 0);
  }

  /** Release both GPU buffers (= cgfx_mesh_destroy). */
  destroy() {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.indexCount = 0;
    this.ok = false;
  }
}
