/**
 * @file buffer.js
 * @brief GPU buffer creation and management (= cgfx_buffer).
 *
 * Mirrors cgfx's typed creators (vertex/index/uniform/storage/mapping) plus a
 * generic constructor. `read()` is async here: cgfx blocks via device-poll, but
 * in the browser buffer mapping is a Promise.
 *
 * Note: WebGPU requires buffer sizes and mapped/written ranges to be multiples
 * of 4 bytes, so jgfx rounds the allocated size up to 4. `size` reflects the
 * allocated (aligned) size.
 */

const align4 = (n) => (n + 3) & ~3;

/** View any BufferSource (ArrayBuffer | TypedArray) as a Uint8Array. */
function asU8(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export class Buffer {
  /**
   * Generic buffer (= cgfx_buffer_create). Uploads `data` if provided.
   * @param {import('./context.js').Context} ctx
   * @param {GPUBufferUsageFlags} usage
   * @param {ArrayBuffer|ArrayBufferView|null} data
   * @param {{size?:number, count?:number, label?:string}} [opts]
   */
  constructor(ctx, usage, data, opts = {}) {
    this.ctx = ctx;
    const rawSize = opts.size ?? (data ? data.byteLength : 0);
    this.size = align4(rawSize);
    this.count = opts.count ?? 0;

    this.buffer = ctx.device.createBuffer({
      label: opts.label ?? "jgfx buffer",
      usage,
      size: this.size,
    });

    if (data && rawSize > 0) {
      // writeBuffer needs a multiple-of-4 byte count; pad if necessary.
      let src = data;
      if (rawSize % 4 !== 0) {
        const padded = new Uint8Array(this.size);
        padded.set(asU8(data));
        src = padded;
      }
      ctx.queue.writeBuffer(this.buffer, 0, src);
    }

    this.ok = !!this.buffer;
  }

  /** Vertex buffer (VERTEX | COPY_DST) with element `count`. */
  static vertex(ctx, data, count) {
    const U = GPUBufferUsage;
    return new Buffer(ctx, U.VERTEX | U.COPY_DST, data, {
      count,
      label: "jgfx vertex buffer",
    });
  }

  /** Index buffer (INDEX | COPY_DST) from a Uint32Array; count = length. */
  static index(ctx, indices) {
    const U = GPUBufferUsage;
    const data =
      indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
    return new Buffer(ctx, U.INDEX | U.COPY_DST, data, {
      count: data.length,
      label: "jgfx index buffer",
    });
  }

  /** Uniform buffer (UNIFORM | COPY_DST). */
  static uniform(ctx, data) {
    const U = GPUBufferUsage;
    return new Buffer(ctx, U.UNIFORM | U.COPY_DST, data, {
      label: "jgfx uniform buffer",
    });
  }

  /** Storage buffer (STORAGE | COPY_DST | COPY_SRC). */
  static storage(ctx, data) {
    const U = GPUBufferUsage;
    return new Buffer(ctx, U.STORAGE | U.COPY_DST | U.COPY_SRC, data, {
      label: "jgfx storage buffer",
    });
  }

  /** Mapping buffer for readback (MAP_READ | COPY_DST); no initial data. */
  static mapping(ctx, size, count = 0) {
    const U = GPUBufferUsage;
    return new Buffer(ctx, U.MAP_READ | U.COPY_DST, null, {
      size,
      count,
      label: "jgfx mapping buffer",
    });
  }

  /**
   * Map and read the buffer back to the CPU (= cgfx_buffer_read, async).
   * Requires MAP_READ usage. Returns a fresh ArrayBuffer copy.
   * @param {number} [size]  defaults to the full buffer
   * @returns {Promise<ArrayBuffer>}
   */
  async read(size) {
    const n = align4(size || this.size);
    await this.buffer.mapAsync(GPUMapMode.READ, 0, n);
    // Copy out before unmap — the mapped range is invalidated on unmap.
    const copy = this.buffer.getMappedRange(0, n).slice(0);
    this.buffer.unmap();
    return copy;
  }

  /**
   * Copy this buffer into `dst` on the GPU and submit (= cgfx_buffer_copy).
   * Requires COPY_SRC on this and COPY_DST on dst.
   * @param {Buffer} dst
   * @param {number} [size]  defaults to min(src, dst)
   */
  copy(dst, size) {
    const n = size || Math.min(this.size, dst.size);
    const encoder = this.ctx.device.createCommandEncoder({
      label: "jgfx buffer copy",
    });
    encoder.copyBufferToBuffer(this.buffer, 0, dst.buffer, 0, n);
    this.ctx.queue.submit([encoder.finish()]);
  }

  /** Release the GPU buffer (= cgfx_buffer_destroy). */
  destroy() {
    this.buffer?.destroy();
    this.buffer = null;
    this.size = 0;
    this.count = 0;
    this.ok = false;
  }
}
