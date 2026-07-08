/**
 * textured_quad — sample a texture onto a quad (new; mirrors cgfx's texture docs).
 *
 * The companion to software_framebuffer: instead of blitting a CPU framebuffer,
 * this uploads a texture *once* and maps it onto real geometry under a
 * perspective camera. It exercises the whole Phase 4 surface — Texture, a
 * LINEAR sampler, and a texture+sampler bind group — plus the Phase 3 Mesh (its
 * texcoord0 attribute) and math.
 *
 * The texture is procedural and chosen to make correctness obvious: a red/green
 * UV gradient (so orientation is unmistakable — black at uv 0,0, red toward +u,
 * green toward +v) with a checkerboard overlay (so linear filtering and
 * perspective foreshortening are visible on the tile edges).
 */
import { Context, Mesh, Texture, createSampler, Binding, math } from "../../jgfx/index.js";
const { mat4, radians } = math;

const TEX = 256; // texture size in texels

const wgsl = /* wgsl */ `
struct U { mvp: mat4x4f };
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs_main(@location(0) position: vec3f, @location(3) uv: vec2f) -> VSOut {
  var o: VSOut;
  o.position = u.mvp * vec4f(position, 1.0);
  o.uv = uv;
  return o;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
`;

// Build the procedural RGBA8 texture described in the header comment.
function makeTexture() {
  const px = new Uint8Array(TEX * TEX * 4);
  const CHECK = TEX / 8; // 8×8 checkerboard
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const u = x / (TEX - 1);
      const v = y / (TEX - 1);
      const check = ((x / CHECK) | 0) + ((y / CHECK) | 0);
      const tint = check % 2 === 0 ? 1.0 : 0.55; // darken alternate tiles
      const i = (y * TEX + x) * 4;
      px[i + 0] = (u * 255 * tint) | 0; // R grows with u
      px[i + 1] = (v * 255 * tint) | 0; // G grows with v
      px[i + 2] = (60 * tint) | 0; // a little blue floor
      px[i + 3] = 255;
    }
  }
  return px;
}

// A unit quad in the XY plane, facing the camera, with texcoords. v grows
// downward in texel space, so we map the top edge (y=+1) to v=0.
function quad() {
  return {
    vertices: [
      { position: [-1, -1, 0], texcoord0: [0, 1] },
      { position: [1, -1, 0], texcoord0: [1, 1] },
      { position: [1, 1, 0], texcoord0: [1, 0] },
      { position: [-1, 1, 0], texcoord0: [0, 0] },
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    depthBuffer: true,
  });

  const shader = ctx.createShader("textured", wgsl, {
    groups: [
      { bindings: [{ binding: 0, minBindingSize: 64 }] }, // mvp uniform
      {
        bindings: [
          { binding: 0, kind: Binding.TEXTURE },
          { binding: 1, kind: Binding.SAMPLER },
        ],
      },
    ],
  });
  const pipeline = ctx.createPipeline({
    shader,
    depthTest: true,
    // cullMode 'none': the quad is single-sided but we want to see its back too
    // as it rotates past edge-on.
    vertexLayouts: [Mesh.vertexLayout()],
  });

  // Upload the texture once; create a linear, clamped sampler.
  const texture = ctx.createTexture({ width: TEX, height: TEX });
  texture.write(makeTexture());
  const sampler = createSampler(ctx); // defaults: linear + clamp-to-edge

  const { vertices, indices } = quad();
  const mesh = ctx.createMesh(vertices, indices);

  const mvp = ctx.createUniform(shader, 0, new Float32Array(16));
  const texBG = shader.createBindGroup(1, [
    { binding: 0, texture },
    { binding: 1, sampler },
  ]);

  let aspect = ctx.width / ctx.height;
  addEventListener("resize", () => {
    ctx.resize(window.innerWidth, window.innerHeight);
    aspect = ctx.width / ctx.height;
  });

  let t = 0;
  function render() {
    t += 0.016;
    // mvp = projection · view · model  (math.multiply(a,b) returns a·b)
    const proj = mat4.perspective(radians(45), aspect, 0.1, 100);
    const view = mat4.lookAt([0, 0, -3], [0, 0, 0], [0, 1, 0]);
    const model = mat4.rotationY(t * 0.7);
    mvp.data.set(mat4.multiply(proj, mat4.multiply(view, model)));
    mvp.write();

    const frame = ctx.beginFrame([0.08, 0.08, 0.12, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setBindGroup(0, mvp.bindGroup);
      frame.pass.setBindGroup(1, texBG);
      mesh.draw(frame.pass);
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
