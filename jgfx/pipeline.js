/**
 * @file pipeline.js
 * @brief Render pipeline creation with sensible defaults (= cgfx_pipeline).
 *
 * Returns the raw GPURenderPipeline, exactly like cgfx returns a raw
 * WGPURenderPipeline — a pipeline is already usable as-is, so there is nothing
 * to wrap. Every descriptor field is optional; omitted fields take the same
 * defaults as cgfx (triangle-list, CCW, no cull, opaque, single surface target).
 */

import { Defaults } from "./constants.js";
import { JgfxError } from "./errors.js";

/**
 * Create a render pipeline.
 *
 * @param {import('./context.js').Context} ctx
 * @param {object} desc
 * @param {import('./shader.js').Shader} desc.shader  required
 * @param {string}  [desc.vertexEntry='vs_main']
 * @param {string}  [desc.fragmentEntry='fs_main']
 * @param {GPUPrimitiveTopology} [desc.topology='triangle-list']
 * @param {GPUCullMode} [desc.cullMode='none']
 * @param {GPUFrontFace} [desc.frontFace='ccw']
 * @param {boolean} [desc.depthTest=false]
 * @param {GPUTextureFormat} [desc.depthFormat='depth24plus']
 * @param {GPUCompareFunction} [desc.depthCompare='less']
 * @param {boolean} [desc.depthWriteDisabled=false]
 * @param {number}  [desc.sampleCount=1]
 * @param {boolean} [desc.alphaToCoverage=false]
 * @param {GPUVertexBufferLayout[]} [desc.vertexLayouts=[]]
 * @param {Array<{format?:GPUTextureFormat, blend?:GPUBlendState, writeMask?:GPUColorWriteFlags}>} [desc.colorTargets]
 * @returns {GPURenderPipeline}
 */
export function createPipeline(ctx, desc) {
  if (!desc || !desc.shader) {
    throw new JgfxError("createPipeline: desc.shader is required");
  }
  const shader = desc.shader;

  const topology = desc.topology ?? Defaults.TOPOLOGY;
  const isStrip = topology === "triangle-strip" || topology === "line-strip";

  // Color targets: default to a single opaque target at the surface format.
  // A zero/omitted writeMask means "all" (cgfx interprets 0 as All, since
  // writing nothing is never the sensible default).
  const targetDescs = desc.colorTargets ?? [null];
  const targets = targetDescs.map((ct) => ({
    format: ct?.format ?? ctx.format,
    writeMask: ct?.writeMask ?? GPUColorWrite.ALL,
    // Opaque unless a blend state is supplied.
    ...(ct?.blend ? { blend: ct.blend } : {}),
  }));

  /** @type {GPURenderPipelineDescriptor} */
  const pipelineDesc = {
    label: "jgfx pipeline",
    // A shader with no bind groups has no explicit layout → 'auto'.
    layout: shader.pipelineLayout ?? "auto",
    vertex: {
      module: shader.module,
      entryPoint: desc.vertexEntry ?? Defaults.VERTEX_ENTRY,
      buffers: desc.vertexLayouts ?? [],
    },
    primitive: {
      topology,
      frontFace: desc.frontFace ?? Defaults.FRONT_FACE,
      cullMode: desc.cullMode ?? Defaults.CULL_MODE,
      ...(isStrip ? { stripIndexFormat: "uint32" } : {}),
    },
    fragment: {
      module: shader.module,
      entryPoint: desc.fragmentEntry ?? Defaults.FRAGMENT_ENTRY,
      targets,
    },
    multisample: {
      count: desc.sampleCount ?? 1,
      mask: 0xffffffff,
      alphaToCoverageEnabled: desc.alphaToCoverage ?? false,
    },
  };

  // Depth/stencil: disabled by default; enabled with Less + depth writes.
  if (desc.depthTest) {
    pipelineDesc.depthStencil = {
      format: desc.depthFormat ?? Defaults.DEPTH_FORMAT,
      depthWriteEnabled: !desc.depthWriteDisabled,
      depthCompare: desc.depthCompare ?? Defaults.DEPTH_COMPARE,
    };
  }

  return ctx.device.createRenderPipeline(pipelineDesc);
}

/** SrcAlpha / OneMinusSrcAlpha (= cgfx_blend_alpha). */
export function blendAlpha() {
  return {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
}

/** One / One additive blend (= cgfx_blend_additive). */
export function blendAdditive() {
  return {
    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  };
}

/** One / OneMinusSrcAlpha premultiplied blend (= cgfx_blend_premultiplied). */
export function blendPremultiplied() {
  return {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
}
