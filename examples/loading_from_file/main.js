/**
 * loading_from_file — load a mesh AND a shader from disk (mirrors cgfx's
 * loading_from_file). This is the Phase 6 example: it exercises the loader
 * module and the shader-from-file path, nothing else new.
 *
 *   - ctx.createShaderFromFile(...)  fetches WGSL text, then compiles it
 *                                    (= cgfx_shader_create_from_file).
 *   - loadMesh(ctx, url)             fetches the LearnWebGPU text format and
 *                                    builds a Mesh (= cgfx_load_tutorial_mesh).
 *
 * The mesh is the LearnWebGPU stacked-triangles glyph (5 floats/point → z=0),
 * drawn flat in 2D. A small uniform recentres it and corrects for aspect ratio.
 */
import { Context, Mesh, loadMesh } from "../../jgfx/index.js";

// The model's origin sits at its bottom-left, and x runs 0‥1.375, y 0‥0.866.
// Shift it back to the centre of the screen (same values cgfx hardcodes).
const OFFSET = [-0.6875, -0.463];

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Shader loaded from a .wgsl file rather than an inline string.
  const shader = await ctx.createShaderFromFile("load", "./load_from_file.wgsl", {
    groups: [{ bindings: [{ binding: 0, minBindingSize: 16 }] }],
  });
  const pipeline = ctx.createPipeline({
    shader,
    vertexLayouts: [Mesh.vertexLayout()],
  });

  // Mesh loaded from the LearnWebGPU text format.
  const mesh = await loadMesh(ctx, "./webgpu.txt");

  // params = (offsetX, offsetY, aspect, pad); updated on resize.
  const params = ctx.createUniform(shader, 0, new Float32Array(4));
  const setAspect = () => {
    params.data[0] = OFFSET[0];
    params.data[1] = OFFSET[1];
    params.data[2] = ctx.width / ctx.height;
    params.write();
  };
  setAspect();

  addEventListener("resize", () => {
    ctx.resize(window.innerWidth, window.innerHeight);
    setAspect();
  });

  function render() {
    const frame = ctx.beginFrame([0.1, 0.1, 0.2, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setBindGroup(0, params.bindGroup);
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
