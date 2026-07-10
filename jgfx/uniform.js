/**
 * @file uniform.js
 * @brief Uniform buffer + bind group bundle (= cgfx_uniform).
 *
 * Bundles a uniform buffer with its bind group and a reference to the user's
 * data. The user keeps ownership of `data` (a TypedArray): mutate it in place,
 * then call write() to upload — the JS analogue of cgfx's data pointer.
 */

import { Buffer } from "./buffer.js";
import { JgfxError } from "./errors.js";
import { bindingByLocation, typeLayout, formatDiagnostic } from "./wgsl.js";

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
    this.#checkSize(ctx, shader, groupIndex, data);
    this.buffer = Buffer.uniform(ctx, data);
    this.bindGroup = shader.createBindGroupBuffers(groupIndex, [this.buffer]);
  }

  /**
   * Compare the TypedArray's byte length against the WGSL type this uniform
   * binds to (group `groupIndex`, binding 0). Struct padding is the classic
   * miss — a vec3f still occupies 16 bytes — so undersized data is diagnosed
   * here, at creation, instead of as a bind-group validation error.
   */
  #checkSize(ctx, shader, groupIndex, data) {
    const mode = ctx.validation ?? "error";
    if (mode === "off" || !shader.model) return;
    const decl = bindingByLocation(shader.model, groupIndex, 0);
    if (!decl || decl.kind !== "buffer") return;
    const layout = typeLayout(shader.model, decl.typeRaw, decl.space);
    if (!layout || layout.size === null || data.byteLength >= layout.size) return;

    const d = {
      severity: "error",
      id: "uniform-data-too-small",
      message:
        `Uniform data is ${data.byteLength} bytes but @group(${groupIndex}) @binding(0) ` +
        `'${decl.name}' needs ${layout.size}.\n` +
        `  wgsl:${decl.line}  ${decl.raw}\n` +
        `  WGSL sizes include alignment padding (SizeOf rounds up to AlignOf = ${layout.align});\n` +
        `  allocate the TypedArray to the padded size.\n` +
        `  fix: new Float32Array(${Math.ceil(layout.size / 4)})`,
    };
    if (mode === "warn") console.error(formatDiagnostic(d, shader.label));
    else throw new JgfxError(formatDiagnostic(d, shader.label), [d]);
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
  }
}
