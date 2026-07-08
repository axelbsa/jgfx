# Compute Pipeline & Render-to-Texture

A guide to compute shaders in jgfx — standalone data-parallel work, mixed
compute-then-render frames, and writing to textures from the GPU. It builds on
the layout system from [Shaders & Bind Groups](shader-bind-groups.md), so read
that first if `@group`/`@binding` descriptors are new to you.

## The Core Insight

**Compute and render are two independent pass types that can share one command
encoder.** A compute pass writes data — into buffers or textures — and a render
pass reads it and draws to the screen. When both passes are recorded on the *same
encoder*, WebGPU guarantees the compute writes are visible to the render pass
before it runs. No manual barriers, no fences, no synchronization primitives: the
data just flows.

```
┌──────────────── one command encoder ────────────────┐
│  ┌──────────────┐   writes    ┌──────────────┐       │
│  │ compute pass │ ──────────► │ render pass  │       │
│  │ textureStore │   flow to   │ textureSample│       │
│  └──────────────┘             └──────────────┘       │
│  ctx.beginEncoder()                 ctx.endFrame()   │
└──────────────────────────────────────────────────────┘
```

This is why jgfx exposes a two-phase [Frame](../api/frame.md) begin: it lets you
open a compute pass *before* the render pass on one encoder, so both submit as a
single command buffer.

## Compute Pipelines

A compute pipeline is far simpler than a render pipeline — no vertex layouts, no
blend state, no depth testing. Just a shader and an entry point:

```js
const pipeline = ctx.createComputePipeline({ shader: computeShader });
```

The entry point defaults to `"cs_main"` (matching jgfx's `vs_main` / `fs_main`
convention); override it with `entryPoint: "my_kernel"`. The pipeline reads its
layout from the shader's `pipelineLayout`, so the shader descriptor defines the
bind groups the pipeline expects. If the shader has no bindings, the pipeline
uses `"auto"` layout inference.

`createComputePipeline` returns a **raw `GPUComputePipeline`** — there is nothing
to wrap, and nothing to `destroy()` (it is garbage-collected).

## Bind Groups for Compute

Compute bindings use the exact same descriptor system as render shaders (see
[Shaders & Bind Groups](shader-bind-groups.md)), with one thing to watch.

### Visibility must be set for buffers

Recall the [default visibilities](shader-bind-groups.md#binding-kinds-and-their-default-visibility):
`Binding.BUFFER` defaults to `VERTEX | FRAGMENT`, textures and samplers to
`FRAGMENT`. None of those include the compute stage, so **compute-stage buffers
and textures need explicit `visibility`**:

```js
const shader = ctx.createShader("vector_add", wgsl, {
  groups: [
    {
      bindings: [
        { binding: 0, type: "read-only-storage", visibility: GPUShaderStage.COMPUTE },
        { binding: 1, type: "read-only-storage", visibility: GPUShaderStage.COMPUTE },
        { binding: 2, type: "storage",           visibility: GPUShaderStage.COMPUTE },
      ],
    },
  ],
});
```

The one kind you can leave alone is `Binding.STORAGE_TEXTURE` — its default
visibility is already `COMPUTE`, since storage textures are almost exclusively a
compute feature. Being explicit anyway does no harm and documents intent.

### Binding at dispatch time

Build the bind group the same way as for rendering — `createBindGroupBuffers`
for buffer-only groups, `createBindGroup` for mixed ones. Bind it on the compute
pass with `.bind([...])` (or `setBindGroup(index, group)`):

```js
const bindGroup = shader.createBindGroupBuffers(0, [bufA, bufB, bufOut]);
cp.setPipeline(pipeline).bind([bindGroup]).dispatch(N / 64);
```

## The Two ComputePass Patterns

A [ComputePass](../api/compute.md) can either own its encoder or borrow one. The
setter methods (`setPipeline`, `setBindGroup`, `bind`, `dispatch`) all return
`this`, so calls chain. The difference is entirely at the boundaries.

### Standalone: `ctx.beginCompute()`

For compute-only work with no rendering. The pass **creates its own encoder** and
**submits on `end()`** — one call in, one call out:

```js
const cp = ctx.beginCompute();                 // creates + owns an encoder
cp.setPipeline(pipeline).bind([bindGroup]).dispatch(N / 64);
cp.end();                                       // ends pass, finishes encoder, submits
```

### Mixed compute+render: `frame.beginComputePass()`

For render-to-texture — compute writes, then render displays. The pass **borrows
the frame's encoder**, and the [Frame](../api/frame.md) owns the single submit,
so the same encoder can open a render pass afterward:

```js
const frame = ctx.beginEncoder();               // encoder only — no render pass yet
const cp = frame.beginComputePass();            // borrows the frame encoder
cp.setPipeline(computePipeline).bind([computeBG]).dispatch(W / 8, H / 8);
cp.end();                                        // ends the pass ONLY — no submit
frame.beginRenderPass([0, 0, 0, 1]);            // open a render pass on the same encoder
// ... draw, sampling the compute output ...
ctx.endFrame(frame);                             // submits both passes together
```

The distinction is the whole point: `end()` on a *standalone* pass finishes and
submits; `end()` on a *borrowed* pass only closes the pass and leaves the encoder
open for the frame.

!!! warning "One active pass at a time"
    A command encoder can have only one pass open at any moment. Always call
    `cp.end()` before `frame.beginRenderPass(...)`. The passes execute in the
    order you record them.

## Workgroups & Dispatch

`dispatch(x, y = 1, z = 1)` launches a grid of **workgroups** (it wraps
`dispatchWorkgroups`). The size of each workgroup — the number of threads it
contains — is declared in the WGSL with `@workgroup_size`, and the two multiply
to the total thread count.

For a 1-D array of `N` elements with a 64-thread workgroup:

```wgsl
@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) id : vec3u) {
  let i = id.x;
  if (i < arrayLength(&output)) { output[i] = input_a[i] + input_b[i]; }
}
```

```js
cp.dispatch(N / 64);   // N/64 workgroups × 64 threads = N threads
```

For a 2-D image with 8×8 workgroups covering a `TEX × TEX` texture:

```wgsl
@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id : vec3u) { /* one thread per texel */ }
```

```js
cp.dispatch(TEX / 8, TEX / 8);   // grid of 8×8-thread groups over the whole texture
```

The `@workgroup_size` in the shader and the dispatch dimensions in JS must line
up to cover your data. Always guard against overrun in the shader — dispatch
counts round up, so the last workgroups can address out-of-bounds indices
(`if (i < arrayLength(&output))` above, or a `textureDimensions` check for
images).

## Standalone Compute with Read-Back

Not all compute produces images. For data-parallel work — physics, sorting,
reduction — you write to storage buffers and read the results back to the CPU.
The read-back is asynchronous in the browser (`mapAsync` is a Promise), so
`buffer.read()` returns a Promise you `await`.

The pattern has three parts:

1. **Storage buffers** via `ctx.createStorageBuffer(data)` — these include
   `COPY_SRC` usage so they can be copied.
2. **Copy to a mapping buffer** with `buffer.copy(readback)` — you cannot map a
   storage buffer directly; WebGPU needs a separate `MAP_READ` buffer.
3. **Read back** with `await readback.read()` — it maps, copies out, and unmaps.

Here is the complete headless vector-add — `output[i] = a[i] + b[i]`:

```js
import { Context } from "../../jgfx/index.js";

const N = 256; // dispatched as N/64 workgroups of 64

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

// A surface is required, but nothing is drawn — use a 1×1 canvas.
const ctx = await Context.create({ canvas, width: 1, height: 1 });

// Three storage buffers, all COMPUTE-visible; the first two read-only.
const shader = ctx.createShader("vector_add", wgsl, {
  groups: [
    {
      bindings: [
        { binding: 0, type: "read-only-storage", visibility: GPUShaderStage.COMPUTE },
        { binding: 1, type: "read-only-storage", visibility: GPUShaderStage.COMPUTE },
        { binding: 2, type: "storage",           visibility: GPUShaderStage.COMPUTE },
      ],
    },
  ],
});
const pipeline = ctx.createComputePipeline({ shader });

const a = new Float32Array(N).map((_, i) => i);
const b = new Float32Array(N).map((_, i) => i * 2);
const bufA   = ctx.createStorageBuffer(a);
const bufB   = ctx.createStorageBuffer(b);
const bufOut = ctx.createStorageBuffer(new Float32Array(N)); // zero-filled output

// buffers[i] binds at @binding(i), matching the shader layout.
const bindGroup = shader.createBindGroupBuffers(0, [bufA, bufB, bufOut]);

// Standalone dispatch: owns its encoder, submits on end().
const cp = ctx.beginCompute();
cp.setPipeline(pipeline).bind([bindGroup]).dispatch(N / 64);
cp.end();

// Copy the output into a mappable buffer, then read it back to the CPU.
const readback = ctx.createMappingBuffer(bufOut.size, N);
bufOut.copy(readback);
const result = new Float32Array(await readback.read());
// result[i] === 3 * i
```

!!! tip "Why the intermediate copy?"
    WebGPU splits storage and mapping into different usages for performance —
    storage buffers live in fast GPU memory, mapping buffers in CPU-visible
    memory. `buffer.copy` bridges them with a one-shot copy. See
    [Buffer](../api/buffer.md) for the buffer factories and `read()`.

## Storage Textures: The Bridge to Rendering

A storage texture is a GPU texture a compute shader writes to directly with
`textureStore()`. The *same* texture can then be sampled in a render pass with
`textureSample()` — the trick is requesting both usages when you create it:

```js
const tex = ctx.createTexture({
  width: TEX,
  height: TEX,
  format: "rgba8unorm",
  usage: GPUTextureUsage.STORAGE_BINDING   // compute writes
       | GPUTextureUsage.TEXTURE_BINDING,  // render samples
});
```

That one texture then appears in **two bind groups with different roles**:

```
        one GPU texture (STORAGE_BINDING | TEXTURE_BINDING)
           │                                   │
   ┌───────▼────────┐                 ┌────────▼────────┐
   │  compute BG    │                 │   render BG     │
   │  Binding.      │                 │  Binding.       │
   │  STORAGE_      │                 │  TEXTURE +      │
   │  TEXTURE (write)│                 │  SAMPLER (read) │
   └────────────────┘                 └─────────────────┘
```

The compute shader declares it as `texture_storage_2d<rgba8unorm, write>` and
writes texels with `textureStore`; the fragment shader declares it as
`texture_2d<f32>` and reads them with `textureSample`. Same memory, two access
patterns — decided entirely by how the two bind groups are set up.

Describe the compute side with `Binding.STORAGE_TEXTURE` and its `storageFormat`
(the format is required — it has no default):

```js
const computeShader = ctx.createShader("julia_compute", computeWgsl, {
  groups: [
    {
      bindings: [
        {
          binding: 0,
          kind: Binding.STORAGE_TEXTURE,
          storageFormat: "rgba8unorm",
          visibility: GPUShaderStage.COMPUTE,
        },
        { binding: 1, minBindingSize: 16, visibility: GPUShaderStage.COMPUTE }, // time uniform
      ],
    },
  ],
});
```

!!! tip "Storage texture vs. storage buffer"
    Use a **storage texture** for image-producing work (procedural textures,
    post-processing, simulation visualization) — the compute shader writes texels
    in place and the render shader samples them directly, no copy. Use a **storage
    buffer** for structured data (arrays of structs, counters) where texel
    addressing does not apply.

## Complete Example: Compute → Render in One Frame

This ties everything together: a compute shader writes an animated fractal into a
storage texture, then a render pass samples it onto a fullscreen quad — both on
one encoder, one submit.

### The shaders

The compute shader writes texels; the render shader samples them. The storage
texture is `@group(0) @binding(0)` on the compute side, and a sampled texture on
the render side:

```wgsl
// compute
struct Params { time : f32 };
@group(0) @binding(0) var output : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params : Params;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id : vec3u) {
  let dims = textureDimensions(output);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  // ... iterate z = z² + c, color by iteration count ...
  textureStore(output, id.xy, color);
}
```

```wgsl
// render — fullscreen quad, 6 procedural vertices, no vertex buffer
@group(0) @binding(0) var tex  : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@fragment fn fs_main(@location(0) uv : vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
```

### Setup

```js
const tex = ctx.createTexture({
  width: TEX, height: TEX, format: "rgba8unorm",
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});
const sampler = ctx.createSampler();

const computePipeline = ctx.createComputePipeline({ shader: computeShader });
const renderPipeline  = ctx.createPipeline({ shader: renderShader });

const params    = new Float32Array(4);            // time + 3 pad = 16 bytes
const paramsBuf = ctx.createUniformBuffer(params);

// Compute BG: storage texture (write) + time uniform.
const computeBG = computeShader.createBindGroup(0, [
  { binding: 0, texture: tex },
  { binding: 1, buffer: paramsBuf },
]);
// Render BG: same texture, now sampled + a sampler.
const renderBG = renderShader.createBindGroup(0, [
  { binding: 0, texture: tex },
  { binding: 1, sampler },
]);
```

Note the same `tex` in both groups — the compute group binds it as a storage
texture, the render group as a sampled texture.

### The loop

```js
function render() {
  params[0] += 0.016;                              // advance time
  ctx.queue.writeBuffer(paramsBuf.buffer, 0, params);

  const frame = ctx.beginEncoder();               // encoder only
  if (frame) {
    // Pass 1 (compute): fill the storage texture, borrowing the frame encoder.
    const cp = frame.beginComputePass();
    cp.setPipeline(computePipeline).bind([computeBG]).dispatch(TEX / 8, TEX / 8);
    cp.end();                                       // ends the pass only

    // Pass 2 (render): sample the texture onto the surface.
    frame.beginRenderPass([0, 0, 0, 1]);
    frame.pass.setPipeline(renderPipeline);
    frame.pass.setBindGroup(0, renderBG);
    frame.pass.draw(6);
    ctx.endFrame(frame);                            // one submit for both passes
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

### The automatic barrier

You never inserted a barrier between the two passes, yet the render pass reliably
sees the fractal the compute pass just wrote. Because both passes were recorded
on the **same encoder**, WebGPU automatically synchronizes the storage-texture
write against the later sample. This is the payoff of `beginEncoder` +
`frame.beginComputePass` + `frame.beginRenderPass`: had you submitted the compute
work as a *separate* command buffer, you would be responsible for ordering it
yourself.

## WGSL Uniformity: `textureSample` Needs Uniform Control Flow

One browser-specific rule bites render passes that sample computed textures.
`textureSample` computes implicit derivatives, so the browser's WGSL
implementation requires it to be called from **uniform control flow** — it must
not sit inside an `if` that branches on a per-pixel (non-uniform) value like `uv`.
Native backends such as cgfx's wgpu-native are lenient here; the browser is not.

The portable fix is to sample **unconditionally**, then pick the result with
`select()`. For example, showing texture A on the left half of the screen and B
on the right:

```wgsl
@fragment fn fs_main(@location(0) uv : vec2f) -> @location(0) vec4f {
  // Sample both unconditionally — textureSample stays in uniform control flow.
  let a = textureSample(texA, samp, vec2f(uv.x * 2.0, uv.y));
  let b = textureSample(texB, samp, vec2f((uv.x - 0.5) * 2.0, uv.y));
  return select(b, a, uv.x < 0.5);   // a on the left, b on the right
}
```

`select(falseValue, trueValue, condition)` chooses per pixel *after* both samples
have already happened, so the sampling itself never depends on the branch. Reach
for this whenever you would otherwise write `if (cond) { return textureSample(...); }`.

## See Also

- [Compute](../api/compute.md) — the full `ComputePass` and pipeline API.
- [Frame](../api/frame.md) — `beginEncoder`, `beginComputePass`, `beginRenderPass`.
- [Texture](../api/texture.md) — creating storage textures and samplers.
- [Shaders & Bind Groups](shader-bind-groups.md) — the descriptor system these
  bind groups use.
