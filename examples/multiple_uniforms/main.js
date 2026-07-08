/**
 * multiple_uniforms — two objects, one shader, different uniforms
 * (= cgfx examples/multiple_uniforms).
 *
 * Demonstrates the "same shader + pipeline, different bind group per object"
 * pattern via Uniform. Each triangle has its own color + offset + rotation, and
 * the user mutates the plain Float32Array then calls uniform.write() each frame.
 */
import { Context } from "../../jgfx/index.js";

const wgsl = /* wgsl */ `
struct MyUniforms {
  color:  vec4f,
  offset: vec4f,   // xy = position, z = rotation angle
};
@group(0) @binding(0) var<uniform> u: MyUniforms;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(
    vec2f(-0.25, -0.25),
    vec2f( 0.25, -0.25),
    vec2f( 0.0,   0.25),
  );
  let a = u.offset.z;
  let c = cos(a);
  let s = sin(a);
  let r = vec2f(p[vi].x * c - p[vi].y * s,
                p[vi].x * s + p[vi].y * c);
  var o: VSOut;
  o.position = vec4f(r + u.offset.xy, 0.0, 1.0);
  o.color = u.color;
  return o;
}

@fragment fn fs_main(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`;

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // One shader with one bind group: @group(0) @binding(0).
  const shader = ctx.createShader("uniforms", wgsl, {
    groups: [{ bindings: [{ binding: 0, minBindingSize: 32 }] }],
  });
  const pipeline = ctx.createPipeline({ shader });

  // Two objects, same layout, different data. [r,g,b,a, ox,oy,rot,_].
  const left = new Float32Array([1.0, 0.3, 0.3, 1.0, -0.4, 0, 0, 0]);
  const right = new Float32Array([0.3, 0.5, 1.0, 1.0, 0.4, 0, 0, 0]);
  const uLeft = ctx.createUniform(shader, 0, left);
  const uRight = ctx.createUniform(shader, 0, right);

  addEventListener("resize", () =>
    ctx.resize(window.innerWidth, window.innerHeight),
  );

  let t = 0;
  function render() {
    t += 0.016;
    left[6] = t; // rotation
    right[6] = -t * 0.7;
    uLeft.write();
    uRight.write();

    const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
    if (frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setBindGroup(0, uLeft.bindGroup);
      frame.pass.draw(3);
      frame.pass.setBindGroup(0, uRight.bindGroup);
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
