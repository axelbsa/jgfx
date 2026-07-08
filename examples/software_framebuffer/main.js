/**
 * software_framebuffer — plot pixels on the CPU, upload, blit (= cgfx twin).
 *
 * The modern equivalent of "draw to a PBO then blit", and a base for an
 * old-school CPU raycaster:
 *
 *   1. Keep a CPU pixel buffer (one uint32 RGBA per pixel) at a small INTERNAL
 *      resolution (FB_W × FB_H).
 *   2. Each frame, write pixels into it (here: a cheap animated XOR pattern —
 *      replace plot() with your raycaster column loop).
 *   3. Upload it to a GPU texture with texture.write() (→ queue.writeTexture).
 *   4. Draw a fullscreen triangle that samples the texture with a NEAREST
 *      sampler, upscaling the tiny framebuffer to the window with crisp pixels.
 *
 * No compute shader needed: the CPU rasterizes, the GPU just blits. Uploading a
 * small framebuffer each frame is negligible.
 */
import { Context, Texture, createSampler, Binding, Filter } from "../../jgfx/index.js";

// Internal render resolution. The canvas is larger; nearest sampling upscales.
const FB_W = 320;
const FB_H = 200;

// Fullscreen triangle (3 verts, no vertex buffer). uv is derived from the clip
// position with a top-left origin, so texel row 0 is the top of the screen.
const wgsl = /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VsOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VsOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv  = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
  return o;
}
@group(0) @binding(0) var fb_tex: texture_2d<f32>;
@group(0) @binding(1) var fb_samp: sampler;
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(fb_tex, fb_samp, uv);
}
`;

// Your "plotting" goes here. Replace with a raycaster: for each screen column,
// cast a ray, compute wall height, write a vertical strip into `px`.
// Pixel packing for rgba8unorm on little-endian: r | g<<8 | b<<16 | a<<24.
function plot(px, t) {
  const scroll = (t * 60) | 0;
  for (let y = 0; y < FB_H; y++) {
    for (let x = 0; x < FB_W; x++) {
      const r = ((x ^ y) + scroll) & 0xff;
      const g = x & 0xff;
      const b = y & 0xff;
      px[y * FB_W + x] = (r | (g << 8) | (b << 16) | (0xff << 24)) >>> 0;
    }
  }
}

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // CPU-side pixel buffer, viewed both as u32 (for packing) and u8 (for upload).
  const pixels = new Uint32Array(FB_W * FB_H);
  const pixelBytes = new Uint8Array(pixels.buffer);

  // The GPU texture we upload into each frame and sample from.
  const fb = ctx.createTexture({
    width: FB_W,
    height: FB_H,
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  // NEAREST sampler for crisp, blocky upscaling of the small framebuffer.
  const sampler = createSampler(ctx, {
    magFilter: Filter.NEAREST,
    minFilter: Filter.NEAREST,
    mipmapFilter: Filter.NEAREST,
  });

  const shader = ctx.createShader("present", wgsl, {
    groups: [
      {
        bindings: [
          { binding: 0, kind: Binding.TEXTURE },
          { binding: 1, kind: Binding.SAMPLER },
        ],
      },
    ],
  });
  const pipeline = ctx.createPipeline({ shader });

  const bindGroup = shader.createBindGroup(0, [
    { binding: 0, texture: fb },
    { binding: 1, sampler },
  ]);

  addEventListener("resize", () =>
    ctx.resize(window.innerWidth, window.innerHeight),
  );

  let t = 0;
  function render() {
    t += 0.016;
    plot(pixels, t); // CPU rasterize
    fb.write(pixelBytes); // upload

    const frame = ctx.beginFrame([0, 0, 0, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setBindGroup(0, bindGroup);
      frame.pass.draw(3, 1, 0, 0); // blit
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
