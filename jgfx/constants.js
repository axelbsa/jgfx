/**
 * @file constants.js
 * @brief Shared enums and defaults for jgfx.
 *
 * These mirror the custom enums in cgfx (CgfxBindingKind, CgfxFilter,
 * CgfxAddressMode). Like cgfx, the DEFAULT member is chosen so that a
 * zero/undefined value resolves to the *sensible* default rather than the
 * WebGPU default (e.g. filtering defaults to 'linear', not 'nearest').
 */

/** Kind of resource a shader binding refers to (= CgfxBindingKind). */
export const Binding = Object.freeze({
  BUFFER: "buffer",
  TEXTURE: "texture",
  SAMPLER: "sampler",
  STORAGE_TEXTURE: "storage-texture",
});

/** Sampler filtering mode (= CgfxFilter). DEFAULT resolves to LINEAR. */
export const Filter = Object.freeze({
  DEFAULT: "default",
  NEAREST: "nearest",
  LINEAR: "linear",
});

/** Sampler address mode (= CgfxAddressMode). DEFAULT resolves to CLAMP. */
export const Address = Object.freeze({
  DEFAULT: "default",
  CLAMP: "clamp-to-edge",
  REPEAT: "repeat",
  MIRROR: "mirror-repeat",
});

/**
 * Resolve a Filter value to a WebGPU GPUFilterMode.
 * @param {string} [filter]
 * @returns {GPUFilterMode}
 */
export function resolveFilter(filter) {
  if (filter === undefined || filter === Filter.DEFAULT) return "linear";
  return /** @type {GPUFilterMode} */ (filter);
}

/**
 * Resolve an Address value to a WebGPU GPUAddressMode.
 * @param {string} [address]
 * @returns {GPUAddressMode}
 */
export function resolveAddress(address) {
  if (address === undefined || address === Address.DEFAULT) return "clamp-to-edge";
  return /** @type {GPUAddressMode} */ (address);
}

/** Library-wide default values (parallels cgfx descriptor defaults). */
export const Defaults = Object.freeze({
  WIDTH: 1280,
  HEIGHT: 720,
  POWER_PREFERENCE: "high-performance",
  DEPTH_FORMAT: "depth24plus",
  TOPOLOGY: "triangle-list",
  CULL_MODE: "none",
  FRONT_FACE: "ccw",
  DEPTH_COMPARE: "less",
  VERTEX_ENTRY: "vs_main",
  FRAGMENT_ENTRY: "fs_main",
  COMPUTE_ENTRY: "cs_main",
});

/** Standard vertex is 96 bytes (= sizeof(CgfxVertex)). */
export const VERTEX_SIZE = 96;

/** Max simultaneous color attachments (= CGFX_MAX_COLOR_TARGETS). */
export const MAX_COLOR_TARGETS = 8;
