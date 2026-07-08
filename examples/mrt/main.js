/**
 * mrt — multiple render targets in one pass (= cgfx twin).
 *
 * Exercises the color-target API and the multi-pass frame:
 *   1. Pass 1 writes TWO offscreen textures at once — a pipeline with two color
 *      targets and a fragment shader with two @location outputs, driven by
 *      frame.beginRenderPassEx({ colorViews: [a, b] }).
 *   2. Pass 2 samples both offscreen textures and shows target A on the left
 *      half of the window and target B on the right.
 *
 * Both offscreen targets are RGBA8Unorm (independent of the surface format),
 * which also exercises rendering to a non-surface format. Both passes share one
 * command encoder via beginEncoder + endRenderPass.
 */
import { Context, Binding, createSampler } from "../../jgfx/index.js";

// Pass 1: fullscreen quad (6 verts), fragment writes two color attachments.
const mrtWgsl = /* wgsl */ `
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
struct FsOut {
  @location(0) target0 : vec4f,
  @location(1) target1 : vec4f,
};
@fragment fn fs_main(@location(0) uv : vec2f) -> FsOut {
  var o : FsOut;
  o.target0 = vec4f(uv.x, uv.y, 0.0, 1.0);        // red/green gradient
  o.target1 = vec4f(0.0, 1.0 - uv.x, uv.y, 1.0);  // green/blue gradient
  return o;
}
`;

// Pass 2: sample both targets — left half = target A, right half = target B.
const presentWgsl = /* wgsl */ `
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
@group(0) @binding(0) var texA : texture_2d<f32>;
@group(0) @binding(1) var texB : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;
@fragment fn fs_main(@location(0) uv : vec2f) -> @location(0) vec4f {
  // Sample both targets unconditionally, then pick per pixel. textureSample
  // needs implicit derivatives, so WGSL requires it in uniform control flow —
  // it must not sit inside an if that branches on the (non-uniform) uv.
  let a = textureSample(texA, samp, vec2f(uv.x * 2.0, uv.y));
  let b = textureSample(texB, samp, vec2f((uv.x - 0.5) * 2.0, uv.y));
  return select(b, a, uv.x < 0.5); // a on the left half, b on the right
}
`;

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const sampler = createSampler(ctx);

  // The MRT shader has no bind groups; the present shader samples both targets.
  const mrtShader = ctx.createShader("mrt", mrtWgsl);
  const presentShader = ctx.createShader("present", presentWgsl, {
    groups: [
      {
        bindings: [
          { binding: 0, kind: Binding.TEXTURE },
          { binding: 1, kind: Binding.TEXTURE },
          { binding: 2, kind: Binding.SAMPLER },
        ],
      },
    ],
  });

  // Pipeline writing two RGBA8Unorm color targets; present uses the default
  // single surface-format target.
  const mrtPipeline = ctx.createPipeline({
    shader: mrtShader,
    colorTargets: [{ format: "rgba8unorm" }, { format: "rgba8unorm" }],
  });
  const presentPipeline = ctx.createPipeline({ shader: presentShader });

  // Two offscreen targets, recreated on resize. `bg` samples them in pass 2.
  let targetA, targetB, presentBG;
  function makeTargets() {
    targetA?.destroy();
    targetB?.destroy();
    const opts = {
      width: ctx.width,
      height: ctx.height,
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    };
    targetA = ctx.createTexture({ label: "mrt target A", ...opts });
    targetB = ctx.createTexture({ label: "mrt target B", ...opts });
    presentBG = presentShader.createBindGroup(0, [
      { binding: 0, texture: targetA },
      { binding: 1, texture: targetB },
      { binding: 2, sampler },
    ]);
  }
  makeTargets();

  addEventListener("resize", () => {
    ctx.resize(window.innerWidth, window.innerHeight);
    makeTargets();
  });

  function render() {
    const frame = ctx.beginEncoder();
    if (frame) {
      // Pass 1: write both offscreen targets in a single MRT pass.
      frame.beginRenderPassEx({
        colorViews: [targetA.view, targetB.view],
        clearColor: [0, 0, 0, 1],
        noDepth: true,
      });
      frame.pass.setPipeline(mrtPipeline);
      frame.pass.draw(6, 1, 0, 0);
      frame.endRenderPass();

      // Pass 2: sample both targets onto the surface (split screen).
      frame.beginRenderPass([0, 0, 0, 1]);
      frame.pass.setPipeline(presentPipeline);
      frame.pass.setBindGroup(0, presentBG);
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
