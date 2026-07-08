# Frame

Per-frame rendering cycle — acquire, record, submit.

**File:** `context.js`

A `Frame` is the transient GPU state for one rendered frame: a command encoder, the current
render pass, and the surface texture view. It is created by
[`Context.beginFrame`](context.md#frame-loop-entry-points) or
[`Context.beginEncoder`](context.md#frame-loop-entry-points), and consumed by
[`Context.endFrame`](context.md#endframe). The `pass` field is your main interaction point —
you record draw commands directly on it.

!!! note "Divergence from cgfx"
    There is no present / device-poll after submit: the browser presents the canvas
    automatically. `beginFrame` / `beginEncoder` return `null` (rather than a `false` out-param)
    when the surface is unavailable — check the return and skip the frame.

---

## The Frame object

Constructed internally when you begin a frame. Public fields:

| Field | Type | Description |
|-------|------|-------------|
| `encoder` | `GPUCommandEncoder` | Command encoder for this frame (labeled `"jgfx frame encoder"`). Record compute passes or manual copies on it. |
| `pass` | `GPURenderPassEncoder \| null` | The active render pass — record draws on this. `null` until a render pass is begun, and after `endRenderPass()`. |
| `targetView` | `GPUTextureView` | The current surface texture view being rendered to. |
| `ctx` | [`Context`](context.md) | The owning context. |

!!! note "`frame.pass` is raw WebGPU"
    jgfx does not wrap draw/bind calls. Between begin and end you drive the standard
    `GPURenderPassEncoder` API directly: `frame.pass.setPipeline(...)`,
    `frame.pass.setBindGroup(...)`, `frame.pass.setVertexBuffer(...)`, `frame.pass.draw(...)`.
    jgfx only hides the encoder / pass / submit ceremony. Helpers like
    [`mesh.draw(frame.pass)`](mesh.md) take the raw pass as an argument.

---

## Two-phase begin

There are two ways to start a frame, mirroring cgfx:

- **`ctx.beginFrame(clearColor)`** — one step. Creates the encoder *and* opens a render pass
  to the surface, so `frame.pass` is ready immediately. Equivalent to `beginEncoder()` followed
  by `frame.beginRenderPass(clearColor)`.
- **`ctx.beginEncoder()`** — encoder only. `frame.pass` is `null`; you open one or more passes
  yourself with `beginRenderPass` / `beginRenderPassEx` / `beginComputePass`. Use this for
  multi-pass, offscreen/MRT, or compute-then-render frames.

Both return `null` when the surface texture cannot be acquired this tick — always guard with
`if (frame) { ... }`.

---

## beginRenderPass

Begin a render pass to the surface (= `cgfx_frame_begin_render_pass`). A thin wrapper over
[`beginRenderPassEx`](#beginrenderpassex) with just a clear color.

```js
frame.beginRenderPass([0, 0, 0, 1]);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `clearColor` | `[r,g,b,a] \| GPUColor` | Clear value for the surface. Arrays and `{r,g,b,a}` objects both work; a missing alpha defaults to `1`. Omit for opaque black `{0,0,0,1}`. |

Opens a pass with one color attachment on `frame.targetView` and, if the context has a depth
buffer, `ctx.depthTexture.view` as the depth attachment (clear `1.0`). Assigns the new pass to
`frame.pass`.

---

## beginRenderPassEx

Begin a render pass with full control: offscreen targets, MRT, MSAA resolve, and explicit or
suppressed depth (= `cgfx_frame_begin_render_pass_ex`).

```js
frame.beginRenderPassEx({
  colorViews: [targetA.view, targetB.view],
  clearColor: [0, 0, 0, 1],
  noDepth: true,
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `desc` | `object` | Render pass configuration. All fields optional; `{}` behaves like `beginRenderPass()` with a transparent-black clear. |

### `desc` fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `colorViews` | `GPUTextureView[]` | — | Color attachment views (offscreen / MRT). Omit → a single attachment on `frame.targetView` (the surface). The pipeline's color targets must match in count and format. |
| `resolveViews` | `GPUTextureView[]` | — | MSAA resolve targets, one per color attachment. Omit → no resolve. |
| `clearColor` | `[r,g,b,a] \| GPUColor` | `{0,0,0,1}` | Clear value applied to every color attachment. |
| `depthView` | `GPUTextureView` | `ctx.depthTexture?.view` | Depth attachment view. Omit → use the context depth buffer if one exists. |
| `noDepth` | `boolean` | `false` | Disable the depth attachment even when the context has a depth buffer. |

Assigns the new pass to `frame.pass`.

!!! note "Pipeline color targets must match"
    With MRT, the pipeline's `colorTargets` array must match `colorViews` in count and format.
    In the **mrt** example, offscreen targets are `rgba8unorm` and the pipeline is built with
    `colorTargets: [{ format: "rgba8unorm" }, { format: "rgba8unorm" }]`. See
    [Pipeline](pipeline.md).

---

## endRenderPass

End the current render pass without submitting (= `cgfx_frame_end_render_pass`).

```js
frame.endRenderPass();
```

Calls `pass.end()` and sets `frame.pass` to `null`. No-op if no pass is open. Use it between
passes when recording more than one render pass into a frame; then begin the next pass, or call
`ctx.endFrame(frame)` to submit.

!!! tip "endRenderPass vs. endFrame"
    `endRenderPass` closes a pass but keeps the encoder open for more work.
    [`endFrame`](context.md#endframe) closes any still-open pass *and* finishes + submits the
    encoder. For the last pass in a frame you can skip `endRenderPass` and let `endFrame` close
    it for you.

---

## beginComputePass

Begin a compute pass on this frame's encoder, for mixed compute + render frames
(= `cgfx_compute_pass_begin`).

```js
const cp = frame.beginComputePass();
cp.setPipeline(computePipeline)
  .bind([computeBG])
  .dispatch(TEX / 8, TEX / 8);
cp.end(); // ends the pass only — the frame still owns the submit
```

**Returns:** a [`ComputePass`](compute.md) that borrows `frame.encoder`.

Because the compute pass shares the frame's encoder, the frame owns the single submit: call
`cp.end()` to close the compute pass, then open a render pass on the same encoder and finish
with `ctx.endFrame(frame)`. WebGPU inserts the storage-write → sample barrier automatically.

!!! tip "Standalone compute"
    For compute work that is *not* part of a render frame, use
    [`ctx.beginCompute()`](compute.md) instead — it owns its own encoder and submit.

---

## endFrame

`Frame` has no `end` method of its own; end a frame via the context:
[`ctx.endFrame(frame)`](context.md#endframe). It closes any open `frame.pass`, finishes the
encoder into a command buffer (labeled `"jgfx frame commands"`), and submits it to the queue.
The browser presents the canvas afterward — there is no explicit present step.

---

## Usage

### Standard frame loop

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

### Mixed compute + render (one submit)

Use `beginEncoder` so the compute and render passes share a single encoder:

```js
function render() {
  params[0] += 0.016;
  ctx.queue.writeBuffer(paramsBuf.buffer, 0, params);

  const frame = ctx.beginEncoder();
  if (frame) {
    // Pass 1 (compute): fill a storage texture on the frame's encoder.
    const cp = frame.beginComputePass();
    cp.setPipeline(computePipeline)
      .bind([computeBG])
      .dispatch(TEX / 8, TEX / 8);
    cp.end();

    // Pass 2 (render): sample the texture onto the surface.
    frame.beginRenderPass([0, 0, 0, 1]);
    frame.pass.setPipeline(renderPipeline);
    frame.pass.setBindGroup(0, renderBG);
    frame.pass.draw(6, 1, 0, 0);
    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
```

### Offscreen / MRT multi-pass

Render into offscreen targets with `beginRenderPassEx`, close with `endRenderPass`, then
composite in a final surface pass:

```js
const frame = ctx.beginEncoder();
if (frame) {
  // Pass 1: write two offscreen targets in a single MRT pass.
  frame.beginRenderPassEx({
    colorViews: [targetA.view, targetB.view],
    clearColor: [0, 0, 0, 1],
    noDepth: true,
  });
  frame.pass.setPipeline(mrtPipeline);
  frame.pass.draw(6, 1, 0, 0);
  frame.endRenderPass();

  // Pass 2: sample both targets onto the surface.
  frame.beginRenderPass([0, 0, 0, 1]);
  frame.pass.setPipeline(presentPipeline);
  frame.pass.setBindGroup(0, presentBG);
  frame.pass.draw(6, 1, 0, 0);
  ctx.endFrame(frame); // closes the final pass and submits
}
```

See the [Context](context.md) reference for creation and the frame-loop entry points,
[Compute](compute.md) for compute passes, and [Architecture](../architecture.md) for the
overall design.
