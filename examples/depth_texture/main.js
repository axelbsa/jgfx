/**
 * depth_texture — visualize scene depth as grayscale (near = white, far = black).
 *
 * cgfx's twin is really a depth-*test* demo (a colored pyramid that occludes
 * itself). This goes one step further and shows what a depth buffer actually
 * looks like: a row of cubes recedes into the distance under a real perspective
 * camera, and the fragment shader paints each pixel by its view-space distance.
 *
 * How the gradient is produced: the vertex shader passes the view-space Z (which,
 * with our left-handed camera, grows with distance from the eye) to the fragment
 * shader, which normalizes it into [0,1] and inverts it so closer is brighter.
 * We visualize a *linear* distance rather than the raw [0,1] depth value, because
 * perspective depth is heavily compressed toward 1.0 and would look nearly flat.
 * Depth testing (depthBuffer:true + depthTest:true) still does the occlusion.
 */
import { Context, Mesh, geometry } from "../../jgfx/index.js";
import { mat4 } from "../../jgfx/math.js";

const wgsl = /* wgsl */ `
struct Camera { projection: mat4x4f, view: mat4x4f };
struct Object { model: mat4x4f };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> object: Object;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) viewZ: f32,
};

@vertex fn vs_main(@location(0) position: vec3f) -> VSOut {
  let world = object.model * vec4f(position, 1.0);
  let viewPos = camera.view * world;      // left-handed: +z points away from eye
  var o: VSOut;
  o.position = camera.projection * viewPos;
  o.viewZ = viewPos.z;                     // linear distance along the view axis
  return o;
}

// Visualized distance window, tuned to where the cubes sit. Anything nearer than
// NEAR_VIS is full white, anything past FAR_VIS is full black.
const NEAR_VIS = 6.0;
const FAR_VIS  = 18.0;

@fragment fn fs_main(@location(0) viewZ: f32) -> @location(0) vec4f {
  let g = 1.0 - clamp((viewZ - NEAR_VIS) / (FAR_VIS - NEAR_VIS), 0.0, 1.0);
  return vec4f(g, g, g, 1.0);
}
`;

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    depthBuffer: true,
  });

  const shader = ctx.createShader("depth", wgsl, {
    groups: [
      { bindings: [{ binding: 0, minBindingSize: 128 }] }, // camera
      { bindings: [{ binding: 0, minBindingSize: 64 }] }, // model
    ],
  });
  const pipeline = ctx.createPipeline({
    shader,
    depthTest: true,
    cullMode: "back", // geometry.* wind for the ccw+back default
    vertexLayouts: [Mesh.vertexLayout()],
  });

  const camera = ctx.createCamera({
    fovy: 50,
    nearZ: 0.1,
    farZ: 40,
    eye: [0, 1.5, -7],
    center: [0, 0, 3],
  });
  const cameraBG = shader.createBindGroupBuffers(0, [camera.buffer]);

  // A row of cubes marching away from the camera — an obvious depth ramp.
  const { vertices, indices } = geometry.cube({ size: 1.2 });
  const mesh = ctx.createMesh(vertices, indices);

  const COUNT = 6;
  const objects = Array.from({ length: COUNT }, (_, i) => ({
    pos: [i % 2 === 0 ? -1.5 : 1.5, 0, i * 2], // alternate sides, step in z
    phase: i * 0.7,
    uniform: ctx.createUniform(shader, 1, new Float32Array(16)),
  }));

  addEventListener("resize", () => {
    ctx.resize(window.innerWidth, window.innerHeight);
    camera.perspective(50, ctx.width / ctx.height, 0.1, 40);
  });

  let t = 0;
  function render() {
    t += 0.016;
    camera.write();

    const frame = ctx.beginFrame([0, 0, 0, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      camera.bind(frame.pass, cameraBG, 0);
      for (const o of objects) {
        const model = mat4.multiply(
          mat4.translation(o.pos[0], o.pos[1], o.pos[2]),
          mat4.rotationY(t + o.phase),
        );
        o.uniform.data.set(model);
        o.uniform.write();
        frame.pass.setBindGroup(1, o.uniform.bindGroup);
        mesh.draw(frame.pass);
      }
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
