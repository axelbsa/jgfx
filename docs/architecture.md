# Architecture

This page describes the internal structure of jgfx: how the modules fit together, the
frame lifecycle, the design principles it inherits from cgfx, and the handful of places it
deliberately diverges because the browser is not C.

## Module Overview

jgfx is organized into focused ES modules, one file per concept, mirroring cgfx's
header/source pairs. The barrel `jgfx/index.js` re-exports all of them.

| Module | File | Purpose |
|--------|------|---------|
| **Context** | `context.js` | WebGPU device, queue, canvas surface — plus the `Frame` lifecycle |
| **Shader** | `shader.js` | WGSL compilation, bind group layouts, pipeline layout |
| **Pipeline** | `pipeline.js` | Render pipeline with zero-init defaults; color targets, depth, MSAA, blend presets |
| **Buffer** | `buffer.js` | GPU buffers (vertex, index, uniform, storage, mapping) + async readback |
| **Uniform** | `uniform.js` | Uniform buffer + bind group + data view bundle |
| **Mesh** | `mesh.js` | Standard 96-byte vertex, mesh creation, vertex layout, draw helpers |
| **Texture** | `texture.js` | GPU texture + view, sampler, depth, per-layer writes |
| **Compute** | `compute.js` | Compute pipeline and compute pass |
| **Camera** | `camera.js` | Projection/view matrices with a GPU uniform |
| **Math** | `math.js` | `mat4` / `vec3` / `vec4` / `mat3` / `quat` helpers (no external math library) |
| **Easing** | `easing.js` | The easings.net set of tweening functions |
| **Geometry** | `geometry.js` | Procedural cube / plane / sphere |
| **Loader** | `loader.js` | Load geometry from the LearnWebGPU text format (temporary) |
| **Constants** | `constants.js` | Enums (`Binding`, `Filter`, `Address`) and `Defaults` |

Unlike cgfx, the `Frame` type lives in `context.js` alongside `Context` (they share the
surface and encoder), rather than in a separate `frame` module.

## Module Dependency Sketch

```
index.js  (barrel — re-exports everything)
  |
  +-- constants.js       (no deps)
  +-- math.js            (no deps)
  +-- easing.js          (no deps)
  +-- shader.js          [constants]
  +-- pipeline.js        [constants]
  +-- buffer.js          [constants]
  +-- texture.js         [constants]
  +-- uniform.js         [buffer]
  +-- mesh.js            [constants, buffer]
  +-- geometry.js        [math, mesh]
  +-- camera.js          [buffer, math]
  +-- compute.js         [constants, shader]
  +-- context.js         [everything above]
  +-- loader.js          [mesh]
```

The `Context` is the foundation — every resource factory takes a context (either as
`new Mesh(ctx, ...)` or the `ctx.createMesh(...)` sugar). The loader sits on top of `Mesh`.

## Initialization Flow

`Context.create` performs the complete WebGPU init sequence in a single `async` call:

```
await Context.create({ canvas, ... })
|
|   1. navigator.gpu.requestAdapter()      — pick a GPU (power preference)
|   2. adapter.requestDevice()             — logical device (limits, features)
|   3. register uncapturederror + device.lost callbacks
|                                            (user-provided, or default console)
|   4. device.queue                        — the default command queue
|   5. canvas.getContext("webgpu").configure()
|                                            — preferred format, premultiplied alpha
|   6. depth texture (optional)            — only if desc.depthBuffer === true
v
Context {
  device, queue, context (GPUCanvasContext), canvas,
  format, depthTexture (or null), width, height
}
```

There is no windowing step (the `<canvas>` already exists) and no explicit surface
object — the canvas *is* the surface.

## Frame Lifecycle

A typical frame:

```
requestAnimationFrame(render)          <-- caller-owned: jgfx never schedules frames
|
|   const frame = ctx.beginFrame(clearColor)
|   |   1. context.getCurrentTexture().createView()   — acquire the surface view
|   |   2. device.createCommandEncoder()
|   |   3. encoder.beginRenderPass()                  — clear color (+ depth if enabled)
|   |   → returns null if the surface is unavailable (skip the frame)
|   v   frame.pass is now an open GPURenderPassEncoder
|
|   --- you record draw commands on frame.pass (raw WebGPU) ---
|       frame.pass.setPipeline(pipeline)
|       frame.pass.setBindGroup(0, bindGroup)
|       frame.pass.draw(3)  /  mesh.draw(frame.pass)
|
|   ctx.endFrame(frame)
|       1. frame.pass.end()
|       2. encoder.finish()
|       3. queue.submit([commands])
|       (the browser presents automatically — no present call, no device poll)
v
```

!!! tip "Frame skipping"
    `beginFrame` returns `null` when the surface texture is momentarily unavailable.
    Always check the return value and skip the frame — never call `endFrame` without a
    successful begin.

!!! note "Two-phase begin"
    `beginFrame` is equivalent to `beginEncoder` + `frame.beginRenderPass`. Use
    `beginEncoder` when you need to run a compute pass before the render pass on the same
    encoder. See the [Frame API reference](api/frame.md).

## Frame and Compute Lifecycle Patterns

Like cgfx, jgfx expresses multi-pass work as "standalone vs. borrow an encoder":

**Frame** (methods on `Context` / `Frame`):

- `ctx.beginFrame` — all-in-one (encoder + render pass)
- `ctx.beginEncoder` + `frame.beginRenderPass` — split, for compute-before-render
- `frame.beginRenderPassEx` — generalized (offscreen, MRT, MSAA resolve, no-depth)
- `frame.endRenderPass` — close a pass without ending the frame (multi-pass)
- `ctx.endFrame` — submit

**Compute** (the `ComputePass` ownership flag):

- `ctx.beginCompute` — standalone; creates and submits its own encoder
- `frame.beginComputePass` — borrows the frame's encoder (compute-then-render in one submit)

The mixed compute+render pattern in one frame:

```js
const frame = ctx.beginEncoder();           // acquire surface, create encoder
const cp = frame.beginComputePass();        // borrow the frame's encoder
cp.setPipeline(computePipeline).bind([bg]).dispatch(n / 64);
cp.end();                                    // ends the pass; frame owns the submit
frame.beginRenderPass([0, 0, 0, 1]);
// ... draw, sampling the compute output ...
ctx.endFrame(frame);
```

## Design Principles

jgfx inherits cgfx's principles, translated to idiomatic JavaScript.

### Transparent objects

Every jgfx object exposes its raw handles. There are no opaque wrappers — reach in and use
the full WebGPU API when jgfx doesn't cover something:

```js
const device = ctx.device;               // GPUDevice
const layout = shader.groupLayouts[0];   // GPUBindGroupLayout
const vbuf   = mesh.vertexBuffer.buffer; // GPUBuffer
```

This makes jgfx a thin layer rather than a walled garden.

### Zero-init defaults

Descriptors are designed so the minimal object produces working defaults; override only
what you care about:

```js
// working defaults: preferred format, premultiplied alpha, no depth buffer
await Context.create({ canvas });

// working defaults: triangle list, no cull, opaque, vs_main/fs_main
ctx.createPipeline({ shader });
```

### No global state

Everything hangs off a `Context` instance. There are no singletons and no hidden
initialization — you can hold more than one context if you need to.

### Caller-owned loop

jgfx never calls `requestAnimationFrame`. You own the loop, its timing, and its input
handling — jgfx only provides `beginFrame`/`endFrame`.

### Thin wrapper

jgfx wraps boilerplate but not draw commands. Between `beginFrame` and `endFrame` you use
the raw `GPURenderPassEncoder` (`frame.pass`) directly, so any WebGPU reference applies.

### Shader owns layouts, caller owns bind groups

A `Shader` owns its `groupLayouts` and `pipelineLayout`. Bind groups are created *from*
those layouts but returned to you, enabling the "same shader, different uniforms per
object" pattern. See [Shader & Bind Groups](guides/shader-bind-groups.md).

## Differences from cgfx

jgfx keeps the API recognizable, but a few things change because the runtime is a browser,
not native C. These are the deliberate divergences to keep in mind when porting cgfx code.

### Forced by the platform

| cgfx (C) | jgfx (browser) | Why |
|----------|----------------|-----|
| `cgfx_ctx_init` (sync) | `await Context.create` (async) | `requestAdapter`/`requestDevice` are Promises |
| `cgfx_buffer_read` (blocking) | `await buffer.read()` (async) | `mapAsync` is a Promise |
| GLFW window + event loop | `<canvas>` + `requestAnimationFrame` | no windowing system in the browser |
| `cgfx_shader_create_from_file` (fopen) | `await ctx.createShaderFromFile` (fetch) | file I/O is async `fetch` |
| Backend `#ifdef` (Dawn vs wgpu-native) | none — the browser is the backend | one target |
| Manual present + device poll | nothing — the browser presents | the compositor drives it |

### Deliberate rendering-convention choices

- **Winding.** `geometry.*` builds meshes wound **clockwise in model space** so the
  default pipeline (`frontFace: "ccw"`, `cullMode: "back"`) shows the exterior. WebGPU
  resolves facing in a Y-down framebuffer, which flips apparent winding versus OpenGL's
  Y-up. (cgfx's C examples inherit the OpenGL winding and render culled cubes inside-out —
  a real cgfx bug.)
- **Math handedness.** `math.js` is **left-handed with a `[0, 1]` depth range**, matching
  cgfx's cglm build (`CGLM_FORCE_LEFT_HANDED` + `CGLM_FORCE_DEPTH_ZERO_TO_ONE`) so
  matrices are numerically identical.
- **WGSL uniformity.** The browser's WGSL implementation strictly enforces that
  `textureSample` is only called from uniform control flow — you cannot sample inside a
  data-dependent `if`. cgfx's wgpu-native backend is lenient about this. The portable fix
  is to sample unconditionally and `select()` the result. (See the `mrt` example.)

### Convenience shifts

- The `Frame` type lives in `context.js`, not a separate module.
- Factories exist both as constructors (`new Mesh(ctx, ...)`) and as `Context` sugar
  (`ctx.createMesh(...)`), so most code reads like a series of `ctx.create*` calls.
- WGSL compile diagnostics are surfaced automatically via `getCompilationInfo()` — cgfx's
  wgpu-native build could not do this.

## Cleanup

GPU objects are garbage-collected, but jgfx keeps cgfx's explicit `destroy()` for
resources you create and discard at runtime. Destroy in reverse creation order — always
release resources before the `Context` that owns the device:

```js
uniform.destroy();
mesh.destroy();
shader.destroy();
ctx.destroy();       // releases the depth buffer and the device
```
