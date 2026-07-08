/**
 * @file shader.js
 * @brief Shader compilation + bind group layout management (= cgfx_shader).
 *
 * A Shader owns the compiled module, the pipeline layout, and the bind group
 * layouts. The caller owns the bind groups and buffers it creates from those
 * layouts — this is cgfx's ownership split that enables "same shader, different
 * uniforms per object".
 */

import { Binding } from "./constants.js";

/**
 * Map a binding kind to its default shader-stage visibility, matching cgfx:
 * textures/samplers default to FRAGMENT, storage textures to COMPUTE, buffers
 * to VERTEX | FRAGMENT.
 * @param {string} kind
 * @returns {GPUShaderStageFlags}
 */
function defaultVisibility(kind) {
  switch (kind) {
    case Binding.TEXTURE:
    case Binding.SAMPLER:
      return GPUShaderStage.FRAGMENT;
    case Binding.STORAGE_TEXTURE:
      return GPUShaderStage.COMPUTE;
    default:
      return GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  }
}

/**
 * Build one GPUBindGroupLayoutEntry from a jgfx BindingDesc, applying the same
 * per-kind defaults as cgfx_shader_create.
 * @param {object} b
 * @returns {GPUBindGroupLayoutEntry}
 */
function buildLayoutEntry(b) {
  const kind = b.kind ?? Binding.BUFFER;
  /** @type {GPUBindGroupLayoutEntry} */
  const entry = {
    binding: b.binding,
    visibility: b.visibility ?? defaultVisibility(kind),
  };

  switch (kind) {
    case Binding.BUFFER:
      entry.buffer = {
        type: b.type ?? "uniform",
        hasDynamicOffset: b.hasDynamicOffset ?? false,
        ...(b.minBindingSize ? { minBindingSize: b.minBindingSize } : {}),
      };
      break;
    case Binding.TEXTURE:
      entry.texture = {
        sampleType: b.sampleType ?? "float",
        viewDimension: b.viewDimension ?? "2d",
      };
      break;
    case Binding.SAMPLER:
      entry.sampler = { type: b.samplerType ?? "filtering" };
      break;
    case Binding.STORAGE_TEXTURE:
      entry.storageTexture = {
        access: b.storageAccess ?? "write-only",
        format: b.storageFormat,
        viewDimension: b.viewDimension ?? "2d",
      };
      break;
    default:
      throw new Error(`[jgfx] unknown binding kind: ${kind}`);
  }
  return entry;
}

/**
 * Bind an array of bind groups starting at `firstIndex`, binding groups[i] to
 * slot firstIndex+i (= cgfx_shader_bind). Works for render or compute passes.
 * Native pass.setBindGroup(i, bg) is equivalent for a single group.
 * @param {GPURenderPassEncoder|GPUComputePassEncoder} pass
 * @param {GPUBindGroup[]} groups
 * @param {number} [firstIndex=0]
 */
export function bind(pass, groups, firstIndex = 0) {
  for (let i = 0; i < groups.length; i++) {
    pass.setBindGroup(firstIndex + i, groups[i]);
  }
}

export class Shader {
  /**
   * @param {import('./context.js').Context} ctx
   * @param {string} label
   * @param {string} wgsl
   * @param {{groups?: Array<{bindings: object[]}>}} [desc]
   */
  constructor(ctx, label, wgsl, desc) {
    this.ctx = ctx;
    this.label = label;
    this.module = ctx.device.createShaderModule({ label, code: wgsl });
    /** @type {GPUBindGroupLayout[]} */
    this.groupLayouts = [];
    /** @type {GPUPipelineLayout | null} */
    this.pipelineLayout = null;
    this.ok = true;

    // Surface WGSL compile diagnostics asynchronously (browsers implement
    // getCompilationInfo; cgfx's wgpu-native build could not).
    this.#reportCompilation();

    const groups = desc?.groups;
    if (!groups || groups.length === 0) return; // no bind groups

    for (const group of groups) {
      const entries = (group.bindings ?? []).map(buildLayoutEntry);
      this.groupLayouts.push(
        ctx.device.createBindGroupLayout({ label: `${label} group`, entries }),
      );
    }

    this.pipelineLayout = ctx.device.createPipelineLayout({
      label: `${label} layout`,
      bindGroupLayouts: this.groupLayouts,
    });
  }

  /** Fetch WGSL from a URL, then create the shader (= cgfx_shader_create_from_file). */
  static async fromFile(ctx, label, url, desc) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`[jgfx] failed to fetch shader '${url}': ${res.status}`);
    }
    const wgsl = await res.text();
    return new Shader(ctx, label, wgsl, desc);
  }

  async #reportCompilation() {
    try {
      const info = await this.module.getCompilationInfo();
      for (const m of info.messages) {
        const where = `${this.label}:${m.lineNum}:${m.linePos}`;
        const text = `[jgfx_shader] ${m.type} at ${where}: ${m.message}`;
        if (m.type === "error") {
          this.ok = false;
          console.error(text);
        } else {
          console.warn(text);
        }
      }
    } catch {
      /* getCompilationInfo unsupported — errors still surface via device error scope */
    }
  }

  /**
   * Create a bind group of buffers, binding buffers[i] at @binding(i)
   * (= cgfx_bind_group_create_buffers).
   * @param {number} groupIndex
   * @param {Array<{buffer: GPUBuffer, size: number}>} buffers  jgfx Buffer objects
   * @returns {GPUBindGroup}
   */
  createBindGroupBuffers(groupIndex, buffers) {
    this.#checkGroup(groupIndex);
    const entries = buffers.map((b, i) => ({
      binding: i,
      resource: { buffer: b.buffer, offset: 0, size: b.size },
    }));
    return this.ctx.device.createBindGroup({
      layout: this.groupLayouts[groupIndex],
      entries,
    });
  }

  /**
   * Create a bind group from explicit entries mixing buffers/textures/samplers
   * (= cgfx_bind_group_create).
   * @param {number} groupIndex
   * @param {Array<{binding:number, buffer?:object, texture?:object, sampler?:GPUSampler, offset?:number, size?:number}>} entries
   * @returns {GPUBindGroup}
   */
  createBindGroup(groupIndex, entries) {
    this.#checkGroup(groupIndex);
    const bgEntries = entries.map((e) => {
      let resource;
      if (e.buffer) {
        resource = {
          buffer: e.buffer.buffer,
          offset: e.offset ?? 0,
          size: e.size ?? e.buffer.size,
        };
      } else if (e.texture) {
        resource = e.texture.view;
      } else if (e.sampler) {
        resource = e.sampler;
      } else {
        throw new Error(`[jgfx] bind group entry ${e.binding} has no resource`);
      }
      return { binding: e.binding, resource };
    });
    return this.ctx.device.createBindGroup({
      layout: this.groupLayouts[groupIndex],
      entries: bgEntries,
    });
  }

  #checkGroup(groupIndex) {
    if (groupIndex >= this.groupLayouts.length) {
      throw new Error(
        `[jgfx] bind group index ${groupIndex} out of range ` +
          `(shader has ${this.groupLayouts.length} groups)`,
      );
    }
  }

  /** Release references (GPU objects here are GC-managed; matches cgfx destroy). */
  destroy() {
    this.module = null;
    this.pipelineLayout = null;
    this.groupLayouts = [];
    this.ok = false;
  }
}
