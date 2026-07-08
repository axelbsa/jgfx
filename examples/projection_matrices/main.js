/**
 * projection_matrices — a rotating 3D pyramid (= cgfx examples/projection_matrices).
 *
 * A faithful port of cgfx's teaching example: the vertex shader does the 3D
 * transform by hand (a Y-axis rotation, an aspect correction, and a manual
 * remap of z into the [0,1] depth range) with only `time` in the uniform. The
 * one deviation is that we pass `aspect` in the uniform instead of hardcoding
 * 1280/720, so it looks right at any window size. Depth testing is on.
 */
import { Context } from "../../jgfx/index.js";
import { Mesh } from "../../jgfx/index.js";

const wgsl = /* wgsl */ `
struct Uniforms { time: f32, aspect: f32 };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex fn vs_main(@location(0) position: vec3f, @location(5) color: vec4f) -> VSOut {
  let a = u.time;
  let c = cos(a);
  let s = sin(a);

  let x = position.x * c + position.z * s;
  let y = position.y;
  let z = -position.x * s + position.z * c;

  var o: VSOut;
  // Squash x by the aspect ratio so the pyramid stays proportioned, and remap
  // z from [-1,1] into WebGPU's [0,1] clip depth.
  o.position = vec4f(x / u.aspect, y, z * 0.5 + 0.5, 1.0);
  o.color = color;
  return o;
}

@fragment fn fs_main(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`;

// A square pyramid: apex + 4 base corners, one flat color per face so the
// rotation reads clearly. Faces are duplicated per triangle (flat shading).
function pyramid() {
  const P = [0, 0.6, 0];
  const A = [-0.6, -0.5, -0.6];
  const B = [0.6, -0.5, -0.6];
  const C = [0.6, -0.5, 0.6];
  const D = [-0.6, -0.5, 0.6];
  const red = [0.95, 0.35, 0.35, 1];
  const grn = [0.4, 0.85, 0.45, 1];
  const blu = [0.4, 0.55, 0.95, 1];
  const yel = [0.95, 0.8, 0.3, 1];
  const gry = [0.55, 0.55, 0.6, 1];

  const tris = [
    [P, A, B, red], // front
    [P, B, C, grn], // right
    [P, C, D, blu], // back
    [P, D, A, yel], // left
    [A, C, B, gry], // base
    [A, D, C, gry],
  ];
  const vertices = [];
  const indices = [];
  for (const [p0, p1, p2, color] of tris) {
    const base = vertices.length;
    vertices.push(
      { position: p0, color },
      { position: p1, color },
      { position: p2, color },
    );
    indices.push(base, base + 1, base + 2);
  }
  return { vertices, indices };
}

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    depthBuffer: true,
  });

  const shader = ctx.createShader("projection", wgsl, {
    groups: [{ bindings: [{ binding: 0, minBindingSize: 16 }] }],
  });
  const pipeline = ctx.createPipeline({
    shader,
    depthTest: true,
    vertexLayouts: [Mesh.vertexLayout()],
  });

  const { vertices, indices } = pyramid();
  const mesh = ctx.createMesh(vertices, indices);

  // Uniform: [time, aspect, pad, pad].
  const u = new Float32Array(4);
  const uniform = ctx.createUniform(shader, 0, u);

  addEventListener("resize", () =>
    ctx.resize(window.innerWidth, window.innerHeight),
  );

  let t = 0;
  function render() {
    t += 0.016;
    u[0] = t;
    u[1] = ctx.width / ctx.height;
    uniform.write();

    const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setBindGroup(0, uniform.bindGroup);
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
