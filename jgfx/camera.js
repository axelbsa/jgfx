/**
 * @file camera.js
 * @brief Camera — projection + view matrices and their GPU uniform (= cgfx_camera).
 *
 * The camera owns a single uniform buffer holding [projection, view] back to
 * back (two mat4x4<f32> = 128 bytes), matching a WGSL struct of two mat4s. Like
 * cgfx, the caller owns the bind group so the camera can share a group with
 * other data (lights, time); build it with shader.createBindGroupBuffers.
 *
 * `fovy` is in DEGREES for readability (converted to radians internally, as
 * cgfx does). Matrices come from math.js: left-handed, depth [0, 1].
 */

import { mat4, radians } from "./math.js";
import { Buffer } from "./buffer.js";

export class Camera {
  /**
   * @param {import('./context.js').Context} ctx
   * @param {object} desc
   * @param {number}   [desc.fovy=45]    vertical FOV in degrees
   * @param {number}   [desc.nearZ=0.01]
   * @param {number}   [desc.farZ=100]
   * @param {number[]} desc.eye          camera position [x,y,z]
   * @param {number[]} desc.center       look-at target [x,y,z]
   * @param {number[]} [desc.up=[0,1,0]]
   */
  constructor(ctx, desc = {}) {
    this.ctx = ctx;
    const fovy = desc.fovy ?? 45;
    const nearZ = desc.nearZ ?? 0.01;
    const farZ = desc.farZ ?? 100;
    const eye = desc.eye ?? [0, 0, 0];
    const center = desc.center ?? [0, 0, 0];
    const up = desc.up ?? [0, 1, 0];
    const aspect = ctx.width / ctx.height;

    // One contiguous block: projection at [0,16), view at [16,32). The GPU
    // buffer is a straight copy of this, so projection must precede view.
    this._gpu = new Float32Array(32);
    /** @type {Float32Array} projection matrix (column-major) */
    this.projection = this._gpu.subarray(0, 16);
    /** @type {Float32Array} view matrix (column-major) */
    this.view = this._gpu.subarray(16, 32);

    this.projection.set(mat4.perspective(radians(fovy), aspect, nearZ, farZ));
    this.view.set(mat4.lookAt(eye, center, up));

    this.buffer = Buffer.uniform(ctx, this._gpu);
  }

  /** Recompute the projection matrix. fovyDeg is in degrees. */
  perspective(fovyDeg, aspect, nearZ, farZ) {
    this.projection.set(mat4.perspective(radians(fovyDeg), aspect, nearZ, farZ));
    return this;
  }

  /** Recompute the view matrix from eye/center/up. */
  lookAt(eye, center, up = [0, 1, 0]) {
    this.view.set(mat4.lookAt(eye, center, up));
    return this;
  }

  /** Upload the current projection+view to the GPU (= cgfx_camera_write). */
  write() {
    this.ctx.queue.writeBuffer(this.buffer.buffer, 0, this._gpu);
  }

  /** Set the camera's bind group on a render pass (= cgfx_camera_bind). */
  bind(pass, bindGroup, groupIndex = 0) {
    pass.setBindGroup(groupIndex, bindGroup);
  }

  /** Release the GPU buffer (= cgfx_camera_destroy). */
  destroy() {
    this.buffer?.destroy();
    this.buffer = null;
  }
}
