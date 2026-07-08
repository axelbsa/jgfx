/**
 * triangle — the simplest jgfx app (= cgfx examples/triangle).
 *
 * Create a context, a shader, a pipeline, and draw a purple triangle whose
 * vertices are generated in the vertex shader from the vertex index. No buffers.
 */
import { Context } from "../../jgfx/index.js";

const wgsl = /* wgsl */ `
@vertex fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f( 0.0,  0.5),
    vec2f(-0.5, -0.5),
    vec2f( 0.5, -0.5),
  );
  return vec4f(pos[idx], 0.0, 1.0);
}

@fragment fn fs_main() -> @location(0) vec4f {
  return vec4f(0.8, 0.4, 1.0, 1.0);
}
`;

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const shader = ctx.createShader("triangle", wgsl);
  const pipeline = ctx.createPipeline({ shader });

  addEventListener("resize", () =>
    ctx.resize(window.innerWidth, window.innerHeight),
  );

  function render() {
    const frame = ctx.beginFrame([0.1, 0.1, 0.2, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.draw(3);
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
