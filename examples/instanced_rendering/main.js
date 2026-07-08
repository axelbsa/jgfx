/**
 * instanced_rendering — a grid of cubes in one instanced draw
 * (= cgfx examples/instanced_rendering).
 *
 * The real Camera example: projection+view live in a uniform (group 0) built by
 * Camera, while each cube's model matrix (four columns) and color come from a
 * per-instance vertex buffer at slot 1 (stepMode 'instance', locations 8–12).
 * A single drawInstanced call renders the whole grid. The web grid is smaller
 * than cgfx's 500×500, but the mechanism is identical.
 */
import { Context, Mesh, geometry } from "../../jgfx/index.js";

const GRID = 40; // 1600 cubes (cgfx uses 500×500 on the desktop)
const COUNT = GRID * GRID;
const SPACING = 1.0;
const CUBE = 0.8;

const wgsl = /* wgsl */ `
struct Camera { projection: mat4x4f, view: mat4x4f };
@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(8)  col0: vec4f,
  @location(9)  col1: vec4f,
  @location(10) col2: vec4f,
  @location(11) col3: vec4f,
  @location(12) color: vec4f,
};

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec4f,
};

@vertex fn vs_main(in: VertexInput) -> VSOut {
  let model = mat4x4f(in.col0, in.col1, in.col2, in.col3);
  let world = model * vec4f(in.position, 1.0);
  var o: VSOut;
  o.position = camera.projection * camera.view * world;
  o.normal = (model * vec4f(in.normal, 0.0)).xyz;
  o.color = in.color;
  return o;
}

@fragment fn fs_main(in: VSOut) -> @location(0) vec4f {
  let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
  let ndotl = max(dot(normalize(in.normal), lightDir), 0.0);
  return vec4f(in.color.rgb * (0.3 + 0.7 * ndotl), 1.0);
}
`;

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    depthBuffer: true,
  });

  const shader = ctx.createShader("instanced", wgsl, {
    groups: [{ bindings: [{ binding: 0, minBindingSize: 128 }] }],
  });

  // Per-instance layout: 4 model columns + color, all vec4, stepMode instance.
  const instanceLayout = {
    arrayStride: 5 * 4 * 4, // 5 vec4f = 80 bytes
    stepMode: "instance",
    attributes: [8, 9, 10, 11, 12].map((loc, i) => ({
      format: "float32x4",
      offset: i * 16,
      shaderLocation: loc,
    })),
  };

  const pipeline = ctx.createPipeline({
    shader,
    depthTest: true,
    // Conventional back-face culling. jgfx's geometry.* wind their exteriors so
    // this default (frontFace:"ccw") shows solid cubes on WebGPU — see the note
    // in geometry.js about the framebuffer Y-flip.
    cullMode: "back",
    vertexLayouts: [Mesh.vertexLayout(), instanceLayout],
  });

  const camera = ctx.createCamera({
    fovy: 60,
    nearZ: 0.1,
    farZ: 500,
    eye: [45, 28, 0],
    center: [0, 0, 0],
  });
  const cameraBG = shader.createBindGroupBuffers(0, [camera.buffer]);

  const { vertices, indices } = geometry.cube({ size: CUBE });
  const cube = ctx.createMesh(vertices, indices);

  // Build per-instance data: identity model with a grid translation + a color.
  const data = new Float32Array(COUNT * 20);
  const offset = ((GRID - 1) * SPACING) / 2;
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      const base = (z * GRID + x) * 20;
      // model columns (col0..col2 identity, col3 = translation)
      data[base + 0] = 1;
      data[base + 5] = 1;
      data[base + 10] = 1;
      data[base + 12] = x * SPACING - offset;
      data[base + 13] = 0;
      data[base + 14] = z * SPACING - offset;
      data[base + 15] = 1;
      // color
      const [r, g, b] = hsvToRgb(
        (x + z) / (GRID * 2),
        0.6 + 0.4 * (x / GRID),
        0.7 + 0.3 * (z / GRID),
      );
      data[base + 16] = r;
      data[base + 17] = g;
      data[base + 18] = b;
      data[base + 19] = 1;
    }
  }
  const instances = ctx.createVertexBuffer(data, COUNT);

  addEventListener("resize", () => {
    ctx.resize(window.innerWidth, window.innerHeight);
    camera.perspective(60, ctx.width / ctx.height, 0.1, 500);
  });

  // Mouse wheel zooms by scaling the camera's distance from the grid.
  let zoom = 1;
  addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom *= e.deltaY > 0 ? 1.1 : 1 / 1.1;
      zoom = Math.min(6, Math.max(0.05, zoom));
    },
    { passive: false },
  );

  let angle = 0;
  function render() {
    angle += 0.005;
    const R = 45;
    camera.lookAt(
      [Math.cos(angle) * R * zoom, 28 * zoom, Math.sin(angle) * R * zoom],
      [0, 0, 0],
    );
    camera.write();

    const frame = ctx.beginFrame([0.05, 0.05, 0.1, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      camera.bind(frame.pass, cameraBG, 0);
      frame.pass.setVertexBuffer(1, instances.buffer, 0, instances.size);
      cube.drawInstanced(frame.pass, COUNT);
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
