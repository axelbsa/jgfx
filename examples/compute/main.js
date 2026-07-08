/**
 * compute — GPU vector addition with read-back (= cgfx twin, browser edition).
 *
 * The headless cgfx example prints to stdout; here we do the same work and show
 * the result on the page. It exercises the whole standalone-compute path:
 *
 *   1. Upload two input arrays as storage buffers, plus an empty output buffer.
 *   2. Dispatch a compute shader (one thread per element) that writes
 *      output[i] = a[i] + b[i].
 *   3. Copy the output storage buffer into a MAP_READ buffer and read it back
 *      to the CPU with the async Buffer.read().
 *
 * There is no rendering — the canvas exists only because Context.create wants a
 * surface. This is the "GPGPU" use of jgfx.
 */
import { Context, Binding } from "../../jgfx/index.js";

const N = 256; // elements; dispatched as N/64 workgroups of 64

const wgsl = /* wgsl */ `
@group(0) @binding(0) var<storage, read>       input_a : array<f32>;
@group(0) @binding(1) var<storage, read>       input_b : array<f32>;
@group(0) @binding(2) var<storage, read_write> output  : array<f32>;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) id : vec3u) {
  let i = id.x;
  if (i < arrayLength(&output)) {
    output[i] = input_a[i] + input_b[i];
  }
}
`;

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({ canvas, width: 1, height: 1 });

  // Input data: a[i] = i, b[i] = i * 2  →  expected output[i] = 3i.
  const a = new Float32Array(N);
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    a[i] = i;
    b[i] = i * 2;
  }

  // A shader with three storage-buffer bindings, all COMPUTE-visible. The
  // first two are read-only, the third is read_write (its output).
  const shader = ctx.createShader("vector_add", wgsl, {
    groups: [
      {
        bindings: [
          { binding: 0, type: "read-only-storage", visibility: GPUShaderStage.COMPUTE },
          { binding: 1, type: "read-only-storage", visibility: GPUShaderStage.COMPUTE },
          { binding: 2, type: "storage", visibility: GPUShaderStage.COMPUTE },
        ],
      },
    ],
  });

  const pipeline = ctx.createComputePipeline({ shader });

  const bufA = ctx.createStorageBuffer(a);
  const bufB = ctx.createStorageBuffer(b);
  const bufOut = ctx.createStorageBuffer(new Float32Array(N)); // zero-filled

  // buffers[i] binds at @binding(i), matching the shader's layout.
  const bindGroup = shader.createBindGroupBuffers(0, [bufA, bufB, bufOut]);

  // Dispatch the compute shader (standalone: owns its encoder, submits on end).
  const cp = ctx.beginCompute();
  cp.setPipeline(pipeline).bind([bindGroup]).dispatch(N / 64);
  cp.end();

  // Copy the results into a mappable buffer, then read them back to the CPU.
  const readback = ctx.createMappingBuffer(bufOut.size, N);
  bufOut.copy(readback);
  const result = new Float32Array(await readback.read());

  // Verify and report.
  let firstBad = -1;
  for (let i = 0; i < N; i++) {
    if (result[i] !== a[i] + b[i]) {
      firstBad = i;
      break;
    }
  }

  const head = Array.from(result.slice(0, 8), (v) => v.toFixed(0)).join(" ");
  const lines = [
    "Vector addition: output[i] = a[i] + b[i]  where a[i]=i, b[i]=2i",
    "",
    `First 8 results: ${head} ...`,
    "Expected:        0 3 6 9 12 15 18 21 ...",
    "",
    firstBad === -1
      ? `<span class="ok">✓ All ${N} results correct.</span>`
      : `<span class="bad">✗ Mismatch at index ${firstBad}: got ${result[firstBad]}, ` +
        `expected ${a[firstBad] + b[firstBad]}.</span>`,
  ];
  document.getElementById("out").innerHTML = lines.join("\n");

  // Tidy up (GC would handle it, but mirror cgfx's explicit teardown).
  readback.destroy();
  bufOut.destroy();
  bufB.destroy();
  bufA.destroy();
}

main().catch((e) => {
  console.error(e);
  const err = document.getElementById("err");
  err.textContent = e.stack || e.message;
});
