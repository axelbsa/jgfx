/**
 * rtiw — Ray Tracing in One Weekend on the compute→render path.
 *
 *   1. A compute shader (compute.wgsl) traces the scene and writes the image
 *      into a storage texture, dispatched as an 8×8-workgroup grid.
 *   2. A render pass samples that texture onto a fullscreen quad.
 *   3. Both passes share ONE command encoder — the compute pass is opened with
 *      frame.beginComputePass() (borrows the encoder), and the frame owns the
 *      single submit. WebGPU inserts the storage-write → sample barrier for us.
 */
import { Context, Binding, createSampler } from "../../jgfx/index.js";

// Render: sample the computed texture onto a fullscreen quad (6 verts, no buffer).
const renderWgsl = /* wgsl */ `
struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};
@vertex fn vs_main(@builtin(vertex_index) vi : u32) -> VsOut {
  var p = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1,  1), vec2f(1, -1), vec2f( 1, 1));
  var uv = array<vec2f, 6>(
    vec2f(0, 1), vec2f(1, 1), vec2f(0, 0),
    vec2f(0, 0), vec2f(1, 1), vec2f(1, 0));
  var o : VsOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv  = uv[vi];
  return o;
}
@group(0) @binding(0) var tex : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@fragment fn fs_main(@location(0) uv : vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
`;

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Storage texture: written by compute, sampled by render — needs both usages.
  const tex = ctx.createTexture({
    width: window.innerWidth,
    height: window.innerHeight,
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const sampler = createSampler(ctx); // linear + clamp

  // Compute group: a write-only storage texture + the time uniform, both COMPUTE.
  const computeShader = await ctx.createShaderFromFile("rtiw_compute", "./compute.wgsl", {
    groups: [
      {
        bindings: [
          {
            binding: 0,
            kind: Binding.STORAGE_TEXTURE,
            storageFormat: "rgba8unorm",
            visibility: GPUShaderStage.COMPUTE,
          },
          { binding: 1, minBindingSize: 16, visibility: GPUShaderStage.COMPUTE },
        ],
      },
    ],
  });

  // Surface WGSL compile errors as a real exception (→ the #err div below)
  // instead of a silently black canvas.
  await computeShader.validate();

  const renderShader = ctx.createShader("quad_render", renderWgsl, {
    groups: [
      {
        bindings: [
          { binding: 0, kind: Binding.TEXTURE },
          { binding: 1, kind: Binding.SAMPLER },
        ],
      },
    ],
  });

  const computePipeline = ctx.createComputePipeline({ shader: computeShader });
  const renderPipeline = ctx.createPipeline({ shader: renderShader });

  // Params uniform (vec4-aligned: time + 3 pad floats = 16 bytes).
  const params = new Float32Array(4);
  const paramsBuf = ctx.createUniformBuffer(params);

  const computeBG = computeShader.createBindGroup(0, [
    { binding: 0, texture: tex },
    { binding: 1, buffer: paramsBuf },
  ]);
  const renderBG = renderShader.createBindGroup(0, [
    { binding: 0, texture: tex },
    { binding: 1, sampler },
  ]);

  addEventListener("resize", () =>
    ctx.resize(window.innerWidth, window.innerHeight),
  );

  function render() {
    params[0] += 0.016; // advance time
    ctx.queue.writeBuffer(paramsBuf.buffer, 0, params);

    const frame = ctx.beginEncoder();
    if (frame) {
      // Pass 1 (compute): fill the storage texture, sharing the frame encoder.
      // dispatch() counts 8×8 workgroups (see @workgroup_size in compute.wgsl),
      // not pixels — round up so partial edge tiles are still covered.
      const cp = frame.beginComputePass();
      cp.setPipeline(computePipeline)
        .bind([computeBG])
        .dispatch(Math.ceil(window.innerWidth / 8), Math.ceil(window.innerHeight / 8));
      cp.end(); // ends the pass only — the frame owns the submit

      // Pass 2 (render): sample the texture onto the surface.
      frame.beginRenderPass([0, 0, 0, 1]);
      frame.pass.setPipeline(renderPipeline);
      frame.pass.setBindGroup(0, renderBG);
      frame.pass.draw(6, 1, 0, 0);
      ctx.endFrame(frame);
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

main().catch((e) => {
  console.error(e);
  const err = document.getElementById("err");
  err.textContent = e.message;
  err.style.display = "grid";
});
