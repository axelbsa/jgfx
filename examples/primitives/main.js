/**
 * primitives — procedural triangle / cube / plane / sphere with a camera
 * (= cgfx examples/primitives).
 *
 * A close port of the cgfx example, including its shader: the fragment color is
 * the surface normal mapped to RGB (`normal * 0.5 + 0.5`). That makes it an easy
 * correctness check — each face's color corresponds to its outward normal (e.g.
 * a face pointing +X reads reddish, +Y greenish, +Z bluish). Camera supplies
 * projection+view (group 0); each object has its own model matrix (group 1).
 * No face culling (cgfx's default), depth testing on.
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
  @location(0) normal: vec3f,
};

@vertex fn vs_main(@location(0) position: vec3f, @location(1) normal: vec3f) -> VSOut {
  let worldPos = object.model * vec4f(position, 1.0);
  let worldNormal = (object.model * vec4f(normal, 0.0)).xyz;
  var o: VSOut;
  o.position = camera.projection * camera.view * worldPos;
  o.normal = normalize(worldNormal);
  return o;
}

@fragment fn fs_main(@location(0) normal: vec3f) -> @location(0) vec4f {
  let color = normal * 0.5 + 0.5;
  return vec4f(color, 1.0);
}
`;

// Single triangle (matches cgfx create_triangle), facing +Z.
function triangle(size) {
  const h = (size * Math.sqrt(3)) / 2;
  const n = [0, 0, 1];
  return {
    vertices: [
      { position: [0, (h * 2) / 3, 0], normal: n },
      { position: [-size / 2, (-h * 1) / 3, 0], normal: n },
      { position: [size / 2, (-h * 1) / 3, 0], normal: n },
    ],
    indices: [0, 1, 2],
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

  const shader = ctx.createShader("primitives", wgsl, {
    groups: [
      { bindings: [{ binding: 0, minBindingSize: 128 }] }, // camera
      { bindings: [{ binding: 0, minBindingSize: 64 }] }, // model
    ],
  });
  const pipeline = ctx.createPipeline({
    shader,
    depthTest: true, // no cullMode → 'none', like cgfx
    vertexLayouts: [Mesh.vertexLayout()],
  });

  const camera = ctx.createCamera({
    fovy: 45,
    eye: [0, 3, -8],
    center: [0, 0, 0],
  });
  const cameraBG = shader.createBindGroupBuffers(0, [camera.buffer]);

  // Four primitives at fixed positions (matches cgfx layout).
  const specs = [
    { geo: triangle(1.5), pos: [-2, 0.5, 2] }, // back left
    { geo: geometry.cube({ size: 1.5 }), pos: [2, 0.5, 2] }, // back right
    { geo: geometry.plane({ size: 2, segments: 4 }), pos: [-2, -0.5, -2] }, // front left
    { geo: geometry.sphere({ radius: 0.8, segments: 24, rings: 16 }), pos: [2, 0, -2] }, // front right
  ];
  const objects = specs.map((s, i) => ({
    mesh: ctx.createMesh(s.geo.vertices, s.geo.indices),
    pos: s.pos,
    phase: i * 1.5,
    uniform: ctx.createUniform(shader, 1, new Float32Array(16)),
  }));

  addEventListener("resize", () => {
    ctx.resize(window.innerWidth, window.innerHeight);
    camera.perspective(45, ctx.width / ctx.height, 0.01, 100);
  });

  let t = 0;
  function render() {
    t += 0.016;
    camera.write();

    const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
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
        o.mesh.draw(frame.pass);
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
