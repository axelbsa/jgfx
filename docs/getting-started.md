# Getting Started

This guide walks you through rendering your first triangle with jgfx. By the end you will
have a purple triangle drawn to a `<canvas>` by WebGPU — the JavaScript twin of cgfx's
triangle example.

## Prerequisites

jgfx is plain ES modules — there is nothing to install and nothing to compile. You only
need:

| Requirement | Notes |
|-------------|-------|
| **A WebGPU browser** | A recent Chromium-based browser, or any browser with WebGPU enabled. Check `navigator.gpu` exists. |
| **A static file server** | WebGPU needs a secure context, so serve over `http://localhost` — WebGPU (and `fetch`) will not work from a `file://` URL. |

!!! tip "Which browser?"
    Any Chromium-based browser with WebGPU enabled works. If `navigator.gpu` is
    `undefined`, WebGPU is off or unavailable — try a newer build or enable the flag.

## Serve & Run

Clone the repository, serve the folder, and open the example menu:

```bash
git clone https://github.com/axelbsa/jgfx.git
cd jgfx
python3 -m http.server 8099      # or: npx serve
```

Open <http://localhost:8099/examples/> and click **triangle**. You should see a purple
triangle on a dark blue background.

## Your First Triangle

Let's walk through the triangle example step by step. This is the simplest possible jgfx
application: create a context, a shader, a pipeline, and render in a loop.

### The Complete Program

```html
<!doctype html>
<canvas id="gfx"></canvas>
<script type="module">
import { Context } from "../../jgfx/index.js";

const wgsl = /* wgsl */ `
@vertex fn vs_main(@builtin(vertex_index) idx : u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
  return vec4f(pos[idx], 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f {
  return vec4f(0.8, 0.4, 1.0, 1.0);
}`;

const canvas = document.getElementById("gfx");
const ctx = await Context.create({ canvas, width: 1280, height: 720 });

const shader = ctx.createShader("triangle shader", wgsl);
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
</script>
```

Now let's break it down piece by piece.

### Step 1: Create the Context

```js
const ctx = await Context.create({ canvas, width: 1280, height: 720 });
```

`Context` is the central object in jgfx. It holds the WebGPU device, command queue, the
configured canvas surface, and (optionally) a depth buffer.

`Context.create` performs the entire WebGPU initialization sequence behind the scenes:

1. Requests a GPU adapter (`navigator.gpu.requestAdapter`)
2. Requests a logical device with the requested limits and features
3. Registers device error / device-lost callbacks
4. Obtains the command queue
5. Configures the canvas context with the preferred format

The only required field is `canvas`. Everything else has a default — `width`/`height`
fall back to the canvas size (or 1280×720), and no depth buffer is created unless you ask
for one with `depthBuffer: true`.

!!! note "Why `await`?"
    `navigator.gpu.requestAdapter` and `requestDevice` return Promises, so
    `Context.create` is `async` and you must `await` it. This is the biggest structural
    difference from cgfx's synchronous `cgfx_ctx_init` — see
    [Architecture](architecture.md#differences-from-cgfx).

!!! note "Transparent objects"
    Every jgfx object exposes its raw handles. After creation you can reach for
    `ctx.device`, `ctx.queue`, `ctx.format`, etc. and use the full WebGPU API alongside
    jgfx whenever it doesn't wrap what you need.

### Step 2: Create a Shader

```js
const shader = ctx.createShader("triangle shader", wgsl);
```

`createShader` compiles a WGSL source string into a `GPUShaderModule`. The first argument
is a debug label (it shows up in GPU error messages), the second is the WGSL source.

An optional third argument, the shader descriptor, describes any bind group layouts the
shader needs. This triangle uses no uniforms, so we omit it — the resulting pipeline uses
WebGPU's automatic layout inference (`layout: "auto"`).

!!! tip "Compile diagnostics"
    jgfx asynchronously calls `getCompilationInfo()` on every module and logs WGSL errors
    and warnings (with line numbers) to the console. If a shader silently fails to render,
    check the console first.

#### What is WGSL?

WGSL (WebGPU Shading Language) is the shader language for WebGPU. The triangle shader:

```wgsl
@vertex fn vs_main(@builtin(vertex_index) idx : u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
  return vec4f(pos[idx], 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f {
  return vec4f(0.8, 0.4, 1.0, 1.0);
}
```

- The **vertex shader** (`vs_main`) runs once per vertex. It uses the built-in
  `vertex_index` to look up a position from a hardcoded array — no vertex buffer needed.
- The **fragment shader** (`fs_main`) runs once per covered pixel and returns solid
  purple.

### Step 3: Create a Pipeline

```js
const pipeline = ctx.createPipeline({ shader });
```

A render pipeline defines how vertices are processed and pixels are drawn. In raw WebGPU
this means filling a large descriptor. jgfx supplies zero-init defaults for all of it:

- **Topology** — triangle list
- **Culling** — none (both faces visible)
- **Front face** — counter-clockwise
- **Blending** — opaque (opt in with a `colorTargets` blend state)
- **Entry points** — `vs_main` / `fs_main`
- **Layout** — taken from the shader (automatic here)

The only required field is `shader`.

### Step 4: The Render Loop

```js
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

The loop has three parts:

1. **`ctx.beginFrame(clearColor)`** — acquires the current surface texture, creates a
   command encoder, and opens a render pass cleared to `clearColor`. It returns `null` if
   the surface is momentarily unavailable — check the return value and skip the frame.

2. **Draw commands on `frame.pass`** — between begin and end you record draw commands
   directly on the raw `GPURenderPassEncoder` (`frame.pass`). jgfx does **not** wrap draw
   calls: you use `setPipeline`, `setBindGroup`, `draw`, `drawIndexed` yourself. Any
   WebGPU tutorial applies directly here.

3. **`ctx.endFrame(frame)`** — ends the render pass, finishes the command buffer, and
   submits it. The browser presents automatically — there is no explicit present call.

4. **`requestAnimationFrame(render)`** — you own the loop. jgfx never schedules frames for
   you.

!!! tip "Why raw WebGPU draw calls?"
    jgfx wraps the boilerplate (init, frame management, buffer creation) but leaves draw
    recording to you, so you get the full power of WebGPU without jgfx becoming a
    bottleneck. `frame.pass` is a plain `GPURenderPassEncoder`.

### Cleanup

Long-lived pages usually let the tab's teardown reclaim GPU resources, but jgfx objects
mirror cgfx's explicit `destroy()` for when you create and discard resources at runtime
(e.g. reloading a scene):

```js
mesh.destroy();
shader.destroy();
ctx.destroy();      // releases the device and depth buffer
```

As in cgfx, destroy resources before the context that owns them.

## Next Steps

- **[Architecture](architecture.md)** — the module structure, the frame lifecycle, and
  the deliberate differences from cgfx.
- **[Shader & Bind Group Architecture](guides/shader-bind-groups.md)** — pass uniform
  data to shaders and render many objects with per-object parameters.
- **[Running & Bundling](building.md)** — serving the examples and the optional
  single-file bundle.
