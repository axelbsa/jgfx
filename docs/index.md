# jgfx

A convenience wrapper around **WebGPU** for the browser — a JavaScript port of
[`cgfx`](https://github.com/axelbsa/cgfx). It abstracts away the verbose WebGPU
boilerplate into a small, idiomatic set of ES-module classes while keeping full access to
the raw `GPU*` handles whenever you need them.

Built directly on the browser's [WebGPU](https://www.w3.org/TR/webgpu/) API and an
HTML `<canvas>` — no bundler, no dependencies, no build step to use the library.

---

## At a Glance

- **Plain ES modules** — `import { Context } from "./jgfx/index.js"` and go. Nothing to
  install, nothing to compile.
- **Transparent objects** — every wrapper exposes its raw handle (`ctx.device`,
  `shader.groupLayouts[0]`, `mesh.vertexBuffer.buffer`) for anything jgfx doesn't cover.
- **Zero-init defaults** — `ctx.createPipeline({ shader })` gives you a working pipeline;
  override only what you need.
- **No global state** — everything hangs off a `Context` instance you pass around.
- **Caller-owned loop** — jgfx never calls `requestAnimationFrame`; you drive the frame.
- **Thin layer** — jgfx manages the boilerplate; you record draw commands on the raw
  `GPURenderPassEncoder`.

---

## Minimal Example

```js
import { Context } from "./jgfx/index.js";

const wgsl = /* wgsl */ `
@vertex fn vs_main(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f {
  return vec4f(0.8, 0.4, 1.0, 1.0);
}`;

const canvas = document.querySelector("canvas");
const ctx = await Context.create({ canvas });

const shader = ctx.createShader("tri", wgsl);
const pipeline = ctx.createPipeline({ shader });

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
```

That is a complete jgfx program: create a context, compile a shader, build a pipeline, and
render in a loop you own. See [Getting Started](getting-started.md) for a line-by-line
walkthrough.

---

## Modules

| Module | File | Description |
|--------|------|-------------|
| [Context](api/context.md) | `context.js` | Device, queue, canvas surface, and per-frame lifecycle |
| [Shader](api/shader.md) | `shader.js` | WGSL compilation, bind group layouts, pipeline layout |
| [Pipeline](api/pipeline.md) | `pipeline.js` | Render pipeline with zero-init defaults |
| [Frame](api/frame.md) | `context.js` | Per-frame begin/end cycle, multi-pass, MRT |
| [Buffer](api/buffer.md) | `buffer.js` | GPU buffers (vertex, index, uniform, storage, mapping) |
| [Uniform](api/uniform.md) | `uniform.js` | Uniform buffer + bind group bundle |
| [Mesh](api/mesh.md) | `mesh.js` | Standard vertex format, mesh creation, indexed draw |
| [Texture](api/texture.md) | `texture.js` | GPU texture + view, sampler, depth, per-layer writes |
| [Compute](api/compute.md) | `compute.js` | Compute pipeline and compute pass |
| [Camera](api/camera.md) | `camera.js` | Projection/view matrices with a GPU uniform |
| [Geometry](api/geometry.md) | `geometry.js` | Procedural cube / plane / sphere generators |
| [Math](api/math.md) | `math.js` | `mat4` / `vec3` / `quat` helpers — no external math library |
| [Easing](api/easing.md) | `easing.js` | The easings.net set of tweening functions |
| [Loader](api/loader.md) | `loader.js` | Load geometry from the LearnWebGPU text format (temporary) |

The `math`, `geometry`, and `easing` helpers are exposed as namespaces. See the
[Math](api/math.md) reference and its [guide](guides/math-and-transforms.md); the
[Geometry](api/geometry.md) reference and its
[Procedural Geometry guide](guides/procedural-geometry.md); and the
[Easing](api/easing.md) reference.

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| **WebGPU browser** | A recent Chromium-based browser, or any browser with WebGPU enabled. |
| **Secure context** | WebGPU needs a secure context; serve over `http://localhost` (not `file://`). |
| **A static file server** | Any will do — `python3 -m http.server`, `npx serve`, etc. |

---

## Quick Start

jgfx is the source — there is nothing to build. Clone it, serve the folder, and open the
examples:

```bash
git clone https://github.com/axelbsa/jgfx.git
cd jgfx
python3 -m http.server 8099      # or: npx serve
```

Then open <http://localhost:8099/examples/> and pick an example.

See [Getting Started](getting-started.md) for a full walkthrough, or
[Running & Bundling](building.md) for the optional single-file bundle.

---

## Relationship to cgfx

jgfx keeps cgfx's module boundaries and philosophy (transparency, zero-init defaults, no
global state, a caller-owned loop, explicit `destroy()`). The differences are the ones the
platform forces — `async` context creation, `async` buffer reads,
`requestAnimationFrame` instead of a native loop, a `<canvas>` instead of GLFW. Those, and
a couple of deliberate rendering-convention choices, are catalogued in
[Architecture](architecture.md#differences-from-cgfx).
