/**
 * vertex_attribute — draw vertices from a GPU buffer (= cgfx examples/vertex_attribute).
 *
 * Two triangles whose 2D positions come from a vertex buffer bound at
 * @location(0), described by an explicit vertex buffer layout.
 */
import { Context } from "../../jgfx/index.js";

const wgsl = /* wgsl */ `
@vertex fn vs_main(@location(0) pos: vec2f) -> @builtin(position) vec4f {
  return vec4f(pos, 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f {
  return vec4f(0.8, 0.4, 1.0, 1.0);
}
`;

// prettier-ignore
const vertexData = new Float32Array([
  // triangle 1
  -0.5, -0.5,
   0.5, -0.5,
   0.0,  0.5,
  // triangle 2
  -0.55, -0.5,
  -0.05,  0.5,
  -0.55,  0.5,
]);
const vertexCount = vertexData.length / 2;

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const shader = ctx.createShader("vertex_attribute", wgsl);

  const vertexBuffer = ctx.createVertexBuffer(vertexData, vertexCount);

  /** @type {GPUVertexBufferLayout} */
  const layout = {
    arrayStride: 2 * 4,
    stepMode: "vertex",
    attributes: [{ shaderLocation: 0, format: "float32x2", offset: 0 }],
  };

  const pipeline = ctx.createPipeline({
    shader,
    vertexLayouts: [layout],
  });

  addEventListener("resize", () =>
    ctx.resize(window.innerWidth, window.innerHeight),
  );

  function render() {
    const frame = ctx.beginFrame([0.1, 0.1, 0.2, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setVertexBuffer(0, vertexBuffer.buffer);
      frame.pass.draw(vertexCount);
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
