/**
 * @file texture.js
 * @brief GPU texture + sampler (= cgfx_texture).
 *
 * A Texture wraps a GPUTexture and its default GPUTextureView in one object, so
 * `texture.view` drops straight into a bind group and `texture.texture` is there
 * for raw WebGPU calls. Loading pixels from disk is not jgfx's concern — the
 * caller produces pixels however it likes (canvas, fetch+ImageBitmap, CPU array)
 * and uploads them with `write()` / `writeLayer()`.
 *
 * Samplers are separate, reusable objects. `createSampler` returns a raw
 * GPUSampler (exactly as cgfx returns a raw WGPUSampler) — a sampler needs no
 * wrapper, and shader.createBindGroup takes it directly.
 */

import { resolveFilter, resolveAddress } from "./constants.js";
import { JgfxError } from "./errors.js";

const DEPTH_ONLY = new Set(["depth16unorm", "depth24plus", "depth32float"]);
const isDepthOnly = (f) => DEPTH_ONLY.has(f);
const isDepth = (f) =>
  isDepthOnly(f) || f === "depth24plus-stencil8" || f === "depth32float-stencil8";

/**
 * Bytes per pixel for the uncompressed formats `write()` supports (mirrors
 * cgfx's bytes_per_pixel). Exotic/compressed formats return undefined → the
 * caller must use raw queue.writeTexture with an explicit layout.
 */
const BYTES_PER_PIXEL = Object.freeze({
  r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1,
  rg8unorm: 2, rg8snorm: 2, rg8uint: 2, rg8sint: 2,
  r16uint: 2, r16sint: 2, r16float: 2,
  r32float: 4, r32uint: 4, r32sint: 4,
  rgba8unorm: 4, "rgba8unorm-srgb": 4, rgba8snorm: 4, rgba8uint: 4, rgba8sint: 4,
  bgra8unorm: 4, "bgra8unorm-srgb": 4,
  rg16uint: 4, rg16sint: 4, rg16float: 4,
  rgb10a2unorm: 4, rg11b10ufloat: 4,
  rg32float: 8, rg32uint: 8, rg32sint: 8,
  rgba16uint: 8, rgba16sint: 8, rgba16float: 8,
  rgba32float: 16, rgba32uint: 16, rgba32sint: 16,
});

export class Texture {
  /**
   * Create a GPU texture and its default view. No pixels are uploaded.
   *
   * Zero-config gives a sampled 2D RGBA8 texture:
   *   new Texture(ctx, { width: 256, height: 256 })
   *
   * @param {import('./context.js').Context} ctx
   * @param {object} desc
   * @param {number}  desc.width               required
   * @param {number}  [desc.height=1]
   * @param {number}  [desc.depth=1]           depth or array layers
   * @param {GPUTextureFormat}    [desc.format='rgba8unorm']
   * @param {GPUTextureDimension} [desc.dimension='2d']
   * @param {number}  [desc.mipLevels=1]
   * @param {number}  [desc.sampleCount=1]
   * @param {GPUTextureUsageFlags} [desc.usage]  default: TEXTURE_BINDING|COPY_DST
   *                                             (RENDER_ATTACHMENT for depth)
   * @param {GPUTextureViewDimension} [desc.viewDimension]  default: auto-detect
   * @param {string} [desc.label]
   */
  constructor(ctx, desc) {
    this.ctx = ctx;
    if (!desc || !desc.width) {
      throw new JgfxError("Texture: desc.width is required");
    }

    const width = desc.width;
    const height = desc.height || 1;
    const depth = desc.depth || 1;
    const mipLevels = desc.mipLevels || 1;
    const format = desc.format || "rgba8unorm";
    const dimension = desc.dimension || "2d";
    const sampleCount = desc.sampleCount || 1;

    const usage =
      desc.usage ||
      (isDepth(format)
        ? GPUTextureUsage.RENDER_ATTACHMENT
        : GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);

    this.texture = ctx.device.createTexture({
      label: desc.label ?? "jgfx texture",
      size: { width, height, depthOrArrayLayers: depth },
      mipLevelCount: mipLevels,
      sampleCount,
      dimension,
      format,
      usage,
      viewFormats: [format],
    });

    // Auto-detect the view dimension from dimension + layer count, like cgfx.
    let viewDim = desc.viewDimension;
    if (!viewDim) {
      if (dimension === "3d") viewDim = "3d";
      else if (dimension === "1d") viewDim = "1d";
      else if (depth > 1) viewDim = "2d-array";
      else viewDim = "2d";
    }

    this.view = this.texture.createView({
      label: `${desc.label ?? "jgfx texture"} view`,
      format,
      dimension: viewDim,
      baseMipLevel: 0,
      mipLevelCount: mipLevels,
      baseArrayLayer: 0,
      arrayLayerCount: depth,
      aspect: isDepthOnly(format) ? "depth-only" : "all",
    });

    this.format = format;
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.mipLevels = mipLevels;
  }

  /**
   * Upload pixel data to mip 0 from origin (0,0,0), across all layers
   * (= cgfx_texture_write). bytesPerRow/rowsPerImage are derived from the
   * format and dimensions. For sub-regions or exotic formats, use raw
   * ctx.queue.writeTexture on `this.texture`.
   * @param {ArrayBufferView|ArrayBuffer} data
   */
  write(data) {
    this.#upload(data, { x: 0, y: 0, z: 0 }, {
      width: this.width,
      height: this.height,
      depthOrArrayLayers: this.depth,
    });
  }

  /**
   * Upload pixel data to a single array layer / cube face
   * (= cgfx_texture_write_layer). For cube maps layers 0–5 are +X,−X,+Y,−Y,+Z,−Z.
   * @param {number} layer
   * @param {ArrayBufferView|ArrayBuffer} data
   */
  writeLayer(layer, data) {
    this.#upload(data, { x: 0, y: 0, z: layer }, {
      width: this.width,
      height: this.height,
      depthOrArrayLayers: 1,
    });
  }

  #upload(data, origin, size) {
    const bpp = BYTES_PER_PIXEL[this.format];
    if (!bpp) {
      throw new JgfxError(
        `Texture.write: unsupported format '${this.format}'. ` +
          `Use ctx.queue.writeTexture directly.`,
      );
    }
    this.ctx.queue.writeTexture(
      { texture: this.texture, mipLevel: 0, origin, aspect: "all" },
      data,
      { offset: 0, bytesPerRow: this.width * bpp, rowsPerImage: this.height },
      size,
    );
  }

  /** Release the texture and its view (= cgfx_texture_destroy). */
  destroy() {
    this.view = null;
    this.texture?.destroy();
    this.texture = null;
  }
}

/**
 * Create a sampler (= cgfx_sampler_create). Returns a raw GPUSampler.
 *
 * Defaults to linear filtering + clamp-to-edge — the Filter/Address enums resolve
 * DEFAULT to those. For crisp pixel-art upscaling:
 *   createSampler(ctx, { magFilter: Filter.NEAREST, minFilter: Filter.NEAREST })
 *
 * @param {import('./context.js').Context} ctx
 * @param {object} [desc]
 * @param {string} [desc.magFilter]   Filter.* — default Linear
 * @param {string} [desc.minFilter]   Filter.* — default Linear
 * @param {string} [desc.mipmapFilter] Filter.* — default Linear
 * @param {string} [desc.addressU]    Address.* — default ClampToEdge
 * @param {string} [desc.addressV]    Address.* — default ClampToEdge
 * @param {string} [desc.addressW]    Address.* — default ClampToEdge
 * @param {number} [desc.maxAnisotropy=1]
 * @param {GPUCompareFunction} [desc.compare]  omit → non-comparison sampler
 * @returns {GPUSampler}
 */
export function createSampler(ctx, desc = {}) {
  return ctx.device.createSampler({
    label: desc.label ?? "jgfx sampler",
    magFilter: resolveFilter(desc.magFilter),
    minFilter: resolveFilter(desc.minFilter),
    mipmapFilter: resolveFilter(desc.mipmapFilter),
    addressModeU: resolveAddress(desc.addressU),
    addressModeV: resolveAddress(desc.addressV),
    addressModeW: resolveAddress(desc.addressW),
    maxAnisotropy: desc.maxAnisotropy || 1,
    lodMinClamp: 0,
    lodMaxClamp: 32,
    ...(desc.compare ? { compare: desc.compare } : {}),
  });
}
