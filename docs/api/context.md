# Context

Device, queue, and canvas-surface management — the root object every other jgfx type hangs off.

**File:** `context.js`

The `Context` combines cgfx's `cgfx_ctx` (device/queue/surface) with the entry points for the
per-frame loop. It owns the `GPUDevice`, the default `GPUQueue`, the configured
`GPUCanvasContext`, and an optional depth buffer. See [Architecture](../architecture.md) for
how it sits at the center of the library.

!!! note "Divergence from cgfx"
    Three things differ from the C library, all because jgfx targets the browser:

    - **Creation is `async`.** `navigator.gpu.requestAdapter` / `requestDevice` return
      Promises, so `Context.create` is `async` and **must** be `await`ed. cgfx's
      `cgfx_ctx_init` is a synchronous wrapper.
    - **The canvas is the surface.** There is no window, no GLFW, no title. You pass an
      existing `<canvas>` element; jgfx configures it as the WebGPU surface.
    - **No present / no device-poll.** The browser presents the canvas automatically after
      the queue submit, so there is no `present` or `wgpuDevicePoll` step in `endFrame`.

---

## Context.create

Create and initialize a context (= `cgfx_ctx_init`). **Asynchronous** — always `await` it.

```js
import { Context } from "./jgfx/index.js";

const canvas = document.getElementById("gfx");
const ctx = await Context.create({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `desc` | `object` | Configuration. `desc.canvas` is required; every other field has a default. |

### `desc` fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `canvas` | `HTMLCanvasElement` | *(required)* | The canvas to configure as the WebGPU surface. |
| `width` | `number` | `canvas.width` or `1280` | Render width in pixels. Also written back to `canvas.width`. |
| `height` | `number` | `canvas.height` or `720` | Render height in pixels. Also written back to `canvas.height`. |
| `depthBuffer` | `boolean` | `false` | Create a depth buffer at surface dimensions, attached automatically each frame. |
| `depthFormat` | `GPUTextureFormat` | `'depth24plus'` | Depth texture format (only used when `depthBuffer` is `true`). |
| `requiredLimits` | `object` | `{}` | Passed straight to `requestDevice`. `{}` means "use device defaults". |
| `requiredFeatures` | `GPUFeatureName[]` | `[]` | Optional device features to request. |
| `powerPreference` | `GPUPowerPreference` | `'high-performance'` | Adapter power preference. |
| `onDeviceError` | `(error: GPUError) => void` | logs to console | `uncapturederror` handler. |
| `onDeviceLost` | `(info: GPUDeviceLostInfo) => void` | logs to console | Device-lost handler. |

**Returns:** `Promise<Context>` — an initialized context.

**Throws** if `desc.canvas` is missing, if `navigator.gpu` is unavailable (no WebGPU), or if
no adapter/device can be obtained.

**Initialization sequence:**

1. Validate `desc.canvas` and `navigator.gpu`.
2. Resolve width/height and write them back onto the canvas.
3. Request an adapter with the chosen `powerPreference`.
4. Request a device with `requiredLimits` / `requiredFeatures`.
5. Register `uncapturederror` and `device.lost` handlers.
6. Grab the default `queue`.
7. Get the `webgpu` context, query the preferred canvas format, and `configure` the surface
   with `alphaMode: "premultiplied"`.
8. If `depthBuffer` is set, create the depth [Texture](texture.md).

!!! warning "WebGPU availability"
    `Context.create` throws `"[jgfx] WebGPU is not available in this browser"` when
    `navigator.gpu` is undefined. Wrap your bootstrap in a `try/catch` and surface a friendly
    message — see the examples' `main().catch(...)` pattern.

---

## Public handles

After `create` resolves, these fields expose the raw WebGPU objects. Reach for them when you
need functionality jgfx does not wrap (writing buffers, custom encoders, texture views, …).

| Field | Type | Description |
|-------|------|-------------|
| `device` | `GPUDevice` | The logical GPU device. |
| `queue` | `GPUQueue` | The default command queue (`device.queue`). Use `ctx.queue.writeBuffer(...)` for uploads. |
| `context` | `GPUCanvasContext` | The configured canvas context; source of each frame's surface texture. |
| `canvas` | `HTMLCanvasElement` | The canvas passed to `create`. |
| `format` | `GPUTextureFormat` | The preferred canvas format. Use this for pipeline color targets that render to the surface. |
| `depthTexture` | `{ texture, view, format } \| null` | The depth buffer, or `null` when `depthBuffer` was not requested. |
| `width` | `number` | Current surface width in pixels. |
| `height` | `number` | Current surface height in pixels. |

---

## Frame loop entry points

The per-frame lifecycle lives on `Context` but produces a [`Frame`](frame.md) object. See the
[Frame](frame.md) reference for full details; in brief:

| Method | Returns | Purpose |
|--------|---------|---------|
| `beginFrame(clearColor)` | `Frame \| null` | Begin a frame with a single render pass to the surface already open on `frame.pass`. |
| `beginEncoder()` | `Frame \| null` | Begin a frame with only an encoder, for multi-pass / compute-then-render frames. |
| `endFrame(frame)` | `void` | Close any open pass, finish the encoder, and submit. |

!!! tip "Check for `null`"
    `beginFrame` / `beginEncoder` return `null` when the surface texture is unavailable this
    tick (e.g. a zero-size canvas). Skip the frame — do not call `endFrame`.

---

## endFrame

End the frame: close any still-open render pass, finish the command encoder, and submit it to
the queue (= `cgfx_frame_end`).

```js
ctx.endFrame(frame);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `frame` | [`Frame`](frame.md) | The frame returned by `beginFrame` / `beginEncoder`. |

There is no explicit present or device-poll step — the browser presents the canvas
automatically after the submit. See the [Frame](frame.md) reference for the full per-frame
API (multi-pass, MRT, compute-then-render).

---

## resize

Resize the surface and recreate the depth buffer (= `cgfx_ctx_resize`).

```js
addEventListener("resize", () =>
  ctx.resize(window.innerWidth, window.innerHeight),
);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `width` | `number` | New surface width in pixels. |
| `height` | `number` | New surface height in pixels. |

**Returns:** `true` on success; `false` if `width` or `height` is zero/falsy (no change made).

Updates `ctx.width` / `ctx.height`, resizes the canvas, and — if a depth buffer exists —
destroys and recreates it at the new size. The canvas context stays configured;
`getCurrentTexture()` automatically follows the new canvas size.

!!! note "Camera projection"
    `resize` does **not** update camera projection. If you keep a [Camera](camera.md), recompute
    its perspective with the new aspect ratio after resizing. Any offscreen render targets you
    manage yourself must also be recreated — see the **mrt** example's `makeTargets()`.

---

## destroy

Release device resources (= `cgfx_ctx_destroy`).

```js
ctx.destroy();
```

Destroys the depth texture (if any), unconfigures the canvas context, and destroys the device.

!!! warning "Destroy order"
    Destroy your pipelines, shaders, buffers, uniforms, meshes, textures, and cameras
    **before** `ctx.destroy()`. The device is destroyed here, and any outstanding GPU
    resources become invalid.

---

## Factory sugar

Every jgfx type also has a standalone constructor / factory, but `Context` exposes convenience
methods that pass `this` for you. Each links to its own reference page for parameters.

### Shaders & pipelines

| Method | Creates | Notes |
|--------|---------|-------|
| `createShader(label, wgsl, desc)` | [`Shader`](shader.md) | Compile WGSL from a string. |
| `createShaderFromFile(label, url, desc)` | `Promise<`[`Shader`](shader.md)`>` | Fetch + compile — `async`. |
| `createPipeline(desc)` | [`Pipeline`](pipeline.md) | Render pipeline. |

### Buffers

| Method | Creates | Notes |
|--------|---------|-------|
| `createBuffer(usage, data, opts)` | [`Buffer`](buffer.md) | Generic buffer. |
| `createVertexBuffer(data, count)` | [`Buffer`](buffer.md) | Vertex buffer. |
| `createIndexBuffer(indices)` | [`Buffer`](buffer.md) | Index buffer. |
| `createUniformBuffer(data)` | [`Buffer`](buffer.md) | Uniform buffer. |
| `createStorageBuffer(data)` | [`Buffer`](buffer.md) | Storage buffer. |
| `createMappingBuffer(size, count)` | [`Buffer`](buffer.md) | Readback / mapping buffer. |

### Binding, geometry, camera

| Method | Creates | Notes |
|--------|---------|-------|
| `createUniform(shader, groupIndex, data)` | [`Uniform`](uniform.md) | Bind-group + backing buffer. |
| `createMesh(vertices, indices)` | [`Mesh`](mesh.md) | Vertex/index mesh. |
| `createCamera(desc)` | [`Camera`](camera.md) | View/projection camera. |

### Textures & samplers

| Method | Creates | Notes |
|--------|---------|-------|
| `createTexture(desc)` | [`Texture`](texture.md) | Texture (color, depth, or storage). |
| `createSampler(desc)` | `GPUSampler` | Sampler with jgfx defaults (linear + clamp). |

### Compute

| Method | Creates | Notes |
|--------|---------|-------|
| `createComputePipeline(desc)` | [`ComputePipeline`](compute.md) | Compute pipeline. |
| `beginCompute()` | [`ComputePass`](compute.md) | Standalone compute pass that owns its own encoder + submit. |

!!! tip "Sugar vs. constructor"
    `ctx.createShader("x", wgsl)` and `new Shader(ctx, "x", wgsl)` are equivalent. The sugar
    just reads better in application code.

---

## Usage

### Minimal bootstrap

```js
import { Context } from "./jgfx/index.js";

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const shader = ctx.createShader("triangle", wgsl);
  const pipeline = ctx.createPipeline({ shader });

  addEventListener("resize", () =>
    ctx.resize(window.innerWidth, window.innerHeight),
  );

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
}

main().catch((e) => console.error(e));
```

### Enabling a depth buffer

```js
const ctx = await Context.create({ canvas, depthBuffer: true });
// ctx.depthTexture is now non-null and attached automatically by beginFrame /
// beginRenderPass. Build your pipeline with a matching depth-stencil state.
```

See the [Frame](frame.md) reference for the full per-frame API, and
[Architecture](../architecture.md) for the big picture.
