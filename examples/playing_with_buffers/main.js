/**
 * playing_with_buffers — buffer copy + async map-read
 * (= cgfx examples/playing_with_buffers).
 *
 * No rendering: create a storage buffer with known data, copy it to a mapping
 * buffer on the GPU, read it back, and verify the round-trip. Shows Buffer's
 * storage/mapping creators, copy(), and the async read().
 */
import { Context } from "../../jgfx/index.js";

const out = document.getElementById("out");
const log = (line, cls) =>
  (out.innerHTML += `\n${cls ? `<span class="${cls}">${line}</span>` : line}`);

async function main() {
  // No canvas needed, but Context.create requires one; use an offscreen canvas.
  const canvas = document.createElement("canvas");
  const ctx = await Context.create({ canvas, width: 1, height: 1 });

  // Source data: 16 floats [0, 1, 2, ... 15].
  const src = new Float32Array(16);
  for (let i = 0; i < src.length; i++) src[i] = i;

  const srcBuf = ctx.createStorageBuffer(src); // STORAGE | COPY_DST | COPY_SRC
  const dstBuf = ctx.createMappingBuffer(src.byteLength); // MAP_READ | COPY_DST

  log(`source:   [${Array.from(src).join(", ")}]`);
  log(`srcBuf.size = ${srcBuf.size}, dstBuf.size = ${dstBuf.size}`);

  // GPU-side copy, then map-read back to the CPU.
  srcBuf.copy(dstBuf);
  const back = new Float32Array(await dstBuf.read());
  log(`readback: [${Array.from(back).join(", ")}]`);

  const match = src.every((v, i) => v === back[i]);
  log(match ? "round-trip OK ✓" : "round-trip MISMATCH ✗", match ? "ok" : "bad");

  srcBuf.destroy();
  dstBuf.destroy();
  ctx.destroy();
}

out.textContent = "";
main().catch((e) => {
  console.error(e);
  log(`error: ${e.message}`, "bad");
});
