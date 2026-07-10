/**
 * @file context.js
 * @brief Context (device/queue/surface) + per-frame lifecycle.
 *        Combines cgfx_ctx and cgfx_frame.
 *
 * Context.create() is async because navigator.gpu.requestAdapter/requestDevice
 * are Promises. The frame loop is caller-owned: you drive requestAnimationFrame
 * and call beginFrame/endFrame yourself, mirroring cgfx's caller-owned loop.
 */

import { Defaults } from "./constants.js";
import { JgfxError } from "./errors.js";
import { Shader } from "./shader.js";
import { createPipeline } from "./pipeline.js";
import { Buffer } from "./buffer.js";
import { Uniform } from "./uniform.js";
import { Mesh } from "./mesh.js";
import { Camera } from "./camera.js";
import { Texture, createSampler } from "./texture.js";
import { ComputePass, createComputePipeline } from "./compute.js";

/** Normalize a clear color ([r,g,b,a] | {r,g,b,a}) to a GPUColor. */
function normalizeColor(c) {
  if (!c) return { r: 0, g: 0, b: 0, a: 1 };
  if (Array.isArray(c)) return { r: c[0], g: c[1], b: c[2], a: c[3] ?? 1 };
  return c;
}

/**
 * A single frame's transient GPU state. Returned by Context.beginFrame /
 * beginEncoder. In the simple path, `pass` is already open and you only touch
 * frame.pass; the beginRenderPass* methods support multi-pass frames.
 */
export class Frame {
  /** @param {Context} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {GPUCommandEncoder} */
    this.encoder = ctx.device.createCommandEncoder({ label: "jgfx frame encoder" });
    /** @type {GPURenderPassEncoder | null} */
    this.pass = null;
    /** @type {GPUTextureView} */
    this.targetView = ctx._acquireTargetView();
  }

  /** Begin a render pass to the surface (= cgfx_frame_begin_render_pass). */
  beginRenderPass(clearColor) {
    this.beginRenderPassEx({ clearColor });
  }

  /**
   * Begin a render pass with full control: offscreen targets, MRT, MSAA
   * resolve, explicit/suppressed depth (= cgfx_frame_begin_render_pass_ex).
   * @param {object} desc
   * @param {GPUTextureView[]} [desc.colorViews]  omit → single surface target
   * @param {GPUTextureView[]} [desc.resolveViews]
   * @param {[number,number,number,number]|GPUColor} [desc.clearColor]
   * @param {GPUTextureView} [desc.depthView]  omit → ctx depth texture
   * @param {boolean} [desc.noDepth]  disable depth even if available
   */
  beginRenderPassEx(desc = {}) {
    const clearValue = normalizeColor(desc.clearColor);
    const views = desc.colorViews;
    const count = views?.length || 1;

    const colorAttachments = [];
    for (let i = 0; i < count; i++) {
      colorAttachments.push({
        view: views ? views[i] : this.targetView,
        resolveTarget: desc.resolveViews ? desc.resolveViews[i] : undefined,
        loadOp: "clear",
        storeOp: "store",
        clearValue,
      });
    }

    let depthView = null;
    if (!desc.noDepth) {
      depthView = desc.depthView ?? this.ctx.depthTexture?.view ?? null;
    }

    /** @type {GPURenderPassDescriptor} */
    const passDesc = { colorAttachments };
    if (depthView) {
      passDesc.depthStencilAttachment = {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      };
    }

    this.pass = this.encoder.beginRenderPass(passDesc);
  }

  /** End the current render pass without submitting (= cgfx_frame_end_render_pass). */
  endRenderPass() {
    if (!this.pass) return;
    this.pass.end();
    this.pass = null;
  }

  /**
   * Begin a compute pass on this frame's encoder, for mixed compute+render
   * frames (= cgfx_compute_pass_begin). The frame owns the submit, so call
   * cp.end() then open a render pass on the same encoder before endFrame.
   * @returns {ComputePass}
   */
  beginComputePass() {
    return ComputePass.onEncoder(this.ctx, this.encoder);
  }
}

export class Context {
  constructor() {
    /** @type {GPUDevice} */ this.device = null;
    /** @type {GPUQueue} */ this.queue = null;
    /** @type {GPUCanvasContext} */ this.context = null;
    /** @type {HTMLCanvasElement} */ this.canvas = null;
    /** @type {GPUTextureFormat} */ this.format = null;
    /** @type {{texture:GPUTexture, view:GPUTextureView, format:GPUTextureFormat}|null} */
    this.depthTexture = null;
    this.width = 0;
    this.height = 0;
    this._depthFormat = Defaults.DEPTH_FORMAT;
    /** @type {'error'|'warn'|'off'} WGSL↔descriptor validation mode */
    this.validation = "error";
  }

  /**
   * Create and initialize a context (= cgfx_ctx_init, async).
   * @param {object} desc
   * @param {HTMLCanvasElement} desc.canvas  required
   * @param {number}  [desc.width]   default: canvas.width or 1280
   * @param {number}  [desc.height]  default: canvas.height or 720
   * @param {boolean} [desc.depthBuffer=false]
   * @param {GPUTextureFormat} [desc.depthFormat='depth24plus']
   * @param {object}  [desc.requiredLimits={}]
   * @param {GPUFeatureName[]} [desc.requiredFeatures=[]]
   * @param {GPUPowerPreference} [desc.powerPreference='high-performance']
   * @param {'error'|'warn'|'off'} [desc.validation='error']  WGSL↔descriptor
   *        mismatch handling: 'error' throws at createShader, 'warn' logs and
   *        continues (cgfx-style), 'off' skips the check entirely
   * @param {(error:GPUError)=>void} [desc.onDeviceError]
   * @param {(info:GPUDeviceLostInfo)=>void} [desc.onDeviceLost]
   * @returns {Promise<Context>}
   */
  static async create(desc) {
    if (!desc || !desc.canvas) {
      throw new JgfxError("Context.create: desc.canvas is required");
    }
    if (!navigator.gpu) {
      throw new JgfxError("WebGPU is not available in this browser");
    }

    const ctx = new Context();
    ctx.validation = desc.validation ?? "error";
    ctx.canvas = desc.canvas;
    ctx.width = desc.width ?? desc.canvas.width ?? Defaults.WIDTH;
    ctx.height = desc.height ?? desc.canvas.height ?? Defaults.HEIGHT;
    ctx.canvas.width = ctx.width;
    ctx.canvas.height = ctx.height;

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: desc.powerPreference ?? Defaults.POWER_PREFERENCE,
    });
    if (!adapter) throw new JgfxError("Failed to obtain a WebGPU adapter");

    ctx.device = await adapter.requestDevice({
      label: "jgfx device",
      requiredLimits: desc.requiredLimits ?? {},
      requiredFeatures: desc.requiredFeatures ?? [],
    });
    if (!ctx.device) throw new JgfxError("Failed to obtain a WebGPU device");

    // Device error / lost callbacks (= cgfx device error/lost callbacks).
    const onError = desc.onDeviceError
      ?? ((e) => console.error(`[jgfx] uncaptured device error: ${e.message}`));
    ctx.device.addEventListener("uncapturederror", (ev) => onError(ev.error));
    const onLost = desc.onDeviceLost
      ?? ((info) => {
        // reason "destroyed" means ctx.destroy() was called — not an error.
        if (info.reason === "destroyed") {
          console.info(`[jgfx] device destroyed: ${info.message}`);
          return;
        }
        console.error(`[jgfx] device lost (${info.reason}): ${info.message}`);
      });
    ctx.device.lost.then(onLost);

    ctx.queue = ctx.device.queue;

    // Configure the canvas surface with the preferred format.
    ctx.context = ctx.canvas.getContext("webgpu");
    ctx.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.context.configure({
      device: ctx.device,
      format: ctx.format,
      alphaMode: "premultiplied",
    });

    if (desc.depthBuffer) {
      ctx._depthFormat = desc.depthFormat ?? Defaults.DEPTH_FORMAT;
      ctx.depthTexture = new Texture(ctx, {
        label: "jgfx depth",
        width: ctx.width,
        height: ctx.height,
        format: ctx._depthFormat,
      });
    }

    return ctx;
  }

  /** Resize the surface and recreate the depth buffer (= cgfx_ctx_resize). */
  resize(width, height) {
    if (!width || !height) return false;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    // The context stays configured; getCurrentTexture follows the canvas size.
    if (this.depthTexture) {
      this.depthTexture.destroy();
      this.depthTexture = new Texture(this, {
        label: "jgfx depth",
        width,
        height,
        format: this._depthFormat,
      });
    }
    return true;
  }

  /** Internal: acquire the current surface texture view, or throw-safe null. */
  _acquireTargetView() {
    return this.context.getCurrentTexture().createView({ label: "jgfx surface view" });
  }

  /**
   * Begin a frame with a single render pass to the surface
   * (= cgfx_frame_begin). Returns null if the surface is unavailable.
   * @param {[number,number,number,number]|GPUColor} [clearColor]
   * @returns {Frame | null}
   */
  beginFrame(clearColor) {
    let frame;
    try {
      frame = new Frame(this);
    } catch {
      return null; // surface unavailable this tick — caller skips the frame
    }
    frame.beginRenderPass(clearColor);
    return frame;
  }

  /**
   * Begin a frame with only a command encoder, for multi-pass / compute-then-
   * render frames (= cgfx_frame_begin_encoder). Returns null if unavailable.
   * @returns {Frame | null}
   */
  beginEncoder() {
    try {
      return new Frame(this);
    } catch {
      return null;
    }
  }

  /** End the frame: close any open pass, finish, submit (= cgfx_frame_end). */
  endFrame(frame) {
    if (frame.pass) {
      frame.pass.end();
      frame.pass = null;
    }
    const commands = frame.encoder.finish({ label: "jgfx frame commands" });
    this.queue.submit([commands]);
    // No present / device-poll: the browser presents automatically.
  }

  /** Release device resources (= cgfx_ctx_destroy). */
  destroy() {
    if (this.depthTexture) {
      this.depthTexture.destroy();
      this.depthTexture = null;
    }
    this.context?.unconfigure();
    this.device?.destroy();
  }

  // ── Factory sugar (each type also has a standalone constructor) ────────
  createShader(label, wgsl, desc) {
    return new Shader(this, label, wgsl, desc);
  }
  createShaderFromFile(label, url, desc) {
    return Shader.fromFile(this, label, url, desc);
  }
  createPipeline(desc) {
    return createPipeline(this, desc);
  }

  // Buffers (= cgfx_buffer_create*).
  createBuffer(usage, data, opts) {
    return new Buffer(this, usage, data, opts);
  }
  createVertexBuffer(data, count) {
    return Buffer.vertex(this, data, count);
  }
  createIndexBuffer(indices) {
    return Buffer.index(this, indices);
  }
  createUniformBuffer(data) {
    return Buffer.uniform(this, data);
  }
  createStorageBuffer(data) {
    return Buffer.storage(this, data);
  }
  createMappingBuffer(size, count) {
    return Buffer.mapping(this, size, count);
  }

  createUniform(shader, groupIndex, data) {
    return new Uniform(this, shader, groupIndex, data);
  }

  // Mesh & camera (= cgfx_mesh_create / cgfx_camera_create).
  createMesh(vertices, indices) {
    return new Mesh(this, vertices, indices);
  }
  createCamera(desc) {
    return new Camera(this, desc);
  }

  // Textures & samplers (= cgfx_texture_create / cgfx_sampler_create).
  createTexture(desc) {
    return new Texture(this, desc);
  }
  createSampler(desc) {
    return createSampler(this, desc);
  }

  // Compute (= cgfx_compute_pipeline_create / cgfx_compute_begin).
  createComputePipeline(desc) {
    return createComputePipeline(this, desc);
  }
  /** Begin a standalone compute pass that owns its encoder. */
  beginCompute() {
    return ComputePass.begin(this);
  }
}
