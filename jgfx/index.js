/**
 * @file index.js
 * @brief Public barrel for jgfx.
 *
 * Re-exports every public class as a named export, and gathers the static
 * helpers/enums into a single `Jgfx` namespace object so both styles work:
 *
 *   import { Context, Shader } from "./jgfx/index.js";
 *   import { Jgfx } from "./jgfx/index.js";  Jgfx.blendAlpha();
 *
 * Class exports are added phase by phase (see PLAN.md §7). Enums/defaults from
 * constants.js are available from Phase 0.
 */

import * as constants from "./constants.js";
import { bind } from "./shader.js";
import { createPipeline, blendAlpha, blendAdditive, blendPremultiplied } from "./pipeline.js";
import { createSampler } from "./texture.js";
import { createComputePipeline } from "./compute.js";
import { parseGeometry, loadGeometry, loadMesh } from "./loader.js";
import * as math from "./math.js";
import * as geometry from "./geometry.js";
import * as easing from "./easing.js";

export {
  Binding,
  Filter,
  Address,
  Defaults,
  VERTEX_SIZE,
  MAX_COLOR_TARGETS,
} from "./constants.js";

// --- Class exports (populated in later phases) ---------------------------
// Phase 1:
export { Context, Frame } from "./context.js";
export { Shader, bind } from "./shader.js";
export { createPipeline, blendAlpha, blendAdditive, blendPremultiplied } from "./pipeline.js";
// Phase 2:
export { Buffer } from "./buffer.js";
export { Uniform } from "./uniform.js";
// Phase 3:
export { Mesh } from "./mesh.js";
export { Camera } from "./camera.js";
export * as math from "./math.js";
export * as geometry from "./geometry.js";
export * as easing from "./easing.js";
// Phase 4:
export { Texture, createSampler } from "./texture.js";
// Phase 5:
export { ComputePass, createComputePipeline } from "./compute.js";
// Phase 6:
export { parseGeometry, loadGeometry, loadMesh } from "./loader.js";
// Post-port (error model + WGSL validation):
export { JgfxError } from "./errors.js";
export * as wgsl from "./wgsl.js";

/**
 * Convenience namespace grouping jgfx statics and enums. Extended alongside the
 * class exports above as each phase lands.
 */
export const Jgfx = {
  Binding: constants.Binding,
  Filter: constants.Filter,
  Address: constants.Address,
  Defaults: constants.Defaults,
  VERTEX_SIZE: constants.VERTEX_SIZE,
  MAX_COLOR_TARGETS: constants.MAX_COLOR_TARGETS,
  // Phase 1 statics
  bind,
  createPipeline,
  blendAlpha,
  blendAdditive,
  blendPremultiplied,
  // Phase 3 statics
  math,
  geometry,
  easing,
  // Phase 4 statics
  createSampler,
  // Phase 5 statics
  createComputePipeline,
  // Phase 6 statics
  parseGeometry,
  loadGeometry,
  loadMesh,
};
