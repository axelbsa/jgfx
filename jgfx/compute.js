/**
 * @file compute.js
 * @brief Compute pipeline + compute pass lifecycle (= cgfx_compute).
 *
 * Two usage patterns, mirroring cgfx:
 *
 * **Standalone** — the pass owns a command encoder and submits on end():
 *   const cp = ctx.beginCompute();
 *   cp.setPipeline(pipeline).bind([bindGroup]).dispatch(N / 64);
 *   cp.end();                       // ends pass, finishes encoder, submits
 *
 * **Mixed compute+render** — the pass borrows a frame's encoder; the frame owns
 * the submit, so the same encoder can then open a render pass:
 *   const frame = ctx.beginEncoder();
 *   const cp = frame.beginComputePass();
 *   cp.setPipeline(pipeline).bind([bindGroup]).dispatch(W / 8, H / 8);
 *   cp.end();                       // ends the pass only — no submit
 *   frame.beginRenderPass(clear);
 *   // ... draw ...
 *   ctx.endFrame(frame);
 *
 * The compute pipeline itself is a raw GPUComputePipeline, exactly as cgfx
 * returns a raw handle — a pipeline is usable as-is, nothing to wrap.
 */

import { Defaults } from "./constants.js";
import { bind } from "./shader.js";

/**
 * Create a compute pipeline (= cgfx_compute_pipeline_create).
 * @param {import('./context.js').Context} ctx
 * @param {object} desc
 * @param {import('./shader.js').Shader} desc.shader  required
 * @param {string} [desc.entryPoint='cs_main']
 * @returns {GPUComputePipeline}
 */
export function createComputePipeline(ctx, desc) {
  if (!desc || !desc.shader) {
    throw new Error("[jgfx] createComputePipeline: desc.shader is required");
  }
  return ctx.device.createComputePipeline({
    label: "jgfx compute pipeline",
    // A shader with no bind groups has no explicit layout → 'auto'.
    layout: desc.shader.pipelineLayout ?? "auto",
    compute: {
      module: desc.shader.module,
      entryPoint: desc.entryPoint ?? Defaults.COMPUTE_ENTRY,
    },
  });
}

/**
 * An open compute pass. Create with Context.beginCompute() (standalone) or
 * Frame.beginComputePass() (embedded in a frame). The setter methods return
 * `this` so calls chain.
 */
export class ComputePass {
  /**
   * @param {import('./context.js').Context} ctx
   * @param {GPUCommandEncoder} encoder
   * @param {boolean} ownsEncoder  true → end() finishes + submits the encoder
   */
  constructor(ctx, encoder, ownsEncoder) {
    this.ctx = ctx;
    this.encoder = encoder;
    this.ownsEncoder = ownsEncoder;
    /** @type {GPUComputePassEncoder} */
    this.pass = encoder.beginComputePass({ label: "jgfx compute pass" });
  }

  /** Begin a standalone pass that owns its encoder (= cgfx_compute_begin). */
  static begin(ctx) {
    const encoder = ctx.device.createCommandEncoder({ label: "jgfx compute encoder" });
    return new ComputePass(ctx, encoder, true);
  }

  /** Begin a pass on a borrowed encoder (= cgfx_compute_pass_begin). */
  static onEncoder(ctx, encoder) {
    return new ComputePass(ctx, encoder, false);
  }

  setPipeline(pipeline) {
    this.pass.setPipeline(pipeline);
    return this;
  }

  setBindGroup(index, bindGroup) {
    this.pass.setBindGroup(index, bindGroup);
    return this;
  }

  /** Bind groups[i] to slot firstIndex+i (= cgfx_shader_bind_compute). */
  bind(groups, firstIndex = 0) {
    bind(this.pass, groups, firstIndex);
    return this;
  }

  /** Dispatch a grid of workgroups (= wgpuComputePassEncoderDispatchWorkgroups). */
  dispatch(x, y = 1, z = 1) {
    this.pass.dispatchWorkgroups(x, y, z);
    return this;
  }

  /**
   * End the pass. If this pass owns its encoder (standalone), also finish the
   * encoder and submit (= cgfx_compute_end). Otherwise only end the pass and
   * leave the encoder to the frame (= cgfx_compute_pass_end).
   */
  end() {
    this.pass.end();
    this.pass = null;
    if (this.ownsEncoder) {
      const commands = this.encoder.finish({ label: "jgfx compute commands" });
      this.ctx.queue.submit([commands]);
    }
  }
}
