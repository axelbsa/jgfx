/**
 * compute_texture — animated Julia set, compute→render in one frame (= cgfx twin).
 *
 * The showcase for the *mixed* compute+render path:
 *   1. A compute shader writes a Julia-set fractal into a storage texture,
 *      dispatched as an 8×8-workgroup grid covering the texture.
 *   2. A render pass samples that texture onto a fullscreen quad.
 *   3. Both passes share ONE command encoder — the compute pass is opened with
 *      frame.beginComputePass() (borrows the encoder), and the frame owns the
 *      single submit. WebGPU inserts the storage-write → sample barrier for us.
 *
 * The fractal's parameter c animates with time, so the pattern morphs.
 */
import { Context, Binding, createSampler } from "../../jgfx/index.js";

const TEX = 1024; // storage texture size (square)

// Compute: write the fractal into a write-only rgba8 storage texture.
const computeWgsl = /* wgsl */ `
struct Params { time : f32 };
@group(0) @binding(0) var output : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params : Params;

fn hsv(h : f32, s : f32, v : f32) -> vec3f {
  let k = vec3f(1.0, 2.0/3.0, 1.0/3.0);
  let p = abs(fract(vec3f(h) + k) * 6.0 - 3.0);
  return v * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), s);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id : vec3u) {
  let dims = textureDimensions(output);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let uv = (vec2f(id.xy) / vec2f(dims)) * 2.0 - 1.0;
  var z = uv * 1.5;
  let c = vec2f(sin(params.time * 0.3) * 0.7885, cos(params.time * 0.23) * 0.7885);

  var iter = 0u;
  let max_iter = 128u;
  for (var i = 0u; i < max_iter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    if (dot(z, z) > 4.0) { break; }
    iter++;
  }

  var color : vec4f;
  if (iter == max_iter) {
    color = vec4f(0.0, 0.0, 0.0, 1.0);
  } else {
    let t = f32(iter) / f32(max_iter);
    let rgb = hsv(t * 3.0 + params.time * 0.1, 0.8, 1.0 - t * 0.3);
    color = vec4f(rgb, 1.0);
  }
  textureStore(output, id.xy, color);
}
`;

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
    /*width: TEX,
    height: TEX,*/
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const sampler = createSampler(ctx); // linear + clamp

  // Compute group: a write-only storage texture + the time uniform, both COMPUTE.
  const computeShader = ctx.createShader("julia_compute", computeWgsl, {
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
      const cp = frame.beginComputePass();
      cp.setPipeline(computePipeline)
        .bind([computeBG])
        .dispatch(TEX / 8, TEX / 8);
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
