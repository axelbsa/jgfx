/**
 * @file uniform.js
 * @brief Uniform buffer + bind group bundle (= cgfx_uniform).
 *
 * Bundles a uniform buffer with its bind group and a reference to the user's
 * data. The user keeps ownership of `data` (a TypedArray): mutate it in place,
 * then call write() to upload — the JS analogue of cgfx's data pointer.
 */

import { Buffer } from "./buffer.js";

export class Uniform {
  /**
   * @param {import('./context.js').Context} ctx
   * @param {import('./shader.js').Shader} shader
   * @param {number} groupIndex
   * @param {ArrayBufferView} data  the user-owned TypedArray (kept by reference)
   */
  constructor(ctx, shader, groupIndex, data) {
    this.ctx = ctx;
    this.data = data;
    this.size = data.byteLength;
    this.buffer = Buffer.uniform(ctx, data);
    this.bindGroup = shader.createBindGroupBuffers(groupIndex, [this.buffer]);
    this.ok = this.buffer.ok && !!this.bindGroup;
  }

  /** Upload the current contents of `data` to the GPU (= cgfx_uniform_write). */
  write() {
    this.ctx.queue.writeBuffer(this.buffer.buffer, 0, this.data);
  }

  /** Release the buffer and bind group (= cgfx_uniform_destroy). */
  destroy() {
    this.buffer.destroy();
    this.bindGroup = null;
    this.data = null;
    this.ok = false;
  }
}
