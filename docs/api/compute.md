# Compute

Compute pipeline creation and compute pass management.

**File:** `compute.js`

jgfx runs compute work through two pieces: [`createComputePipeline`](#createcomputepipeline),
which turns a [`Shader`](shader.md) into a raw `GPUComputePipeline`, and the
[`ComputePass`](#computepass) class, an open pass with chainable
`setPipeline` / `bind` / `dispatch` methods.

There are two ways to run a pass, mirroring cgfx:

- **Standalone** — `ctx.beginCompute()`. The pass owns its own command encoder and
  **submits** when you call `end()`. Use this for compute-only ("GPGPU") work.
- **Mixed compute + render** — `frame.beginComputePass()`. The pass **borrows** the frame's
  encoder; `end()` closes only the pass, and the *frame* owns the single submit — so the
  same encoder can then open a render pass that reads the compute results.

---

## createComputePipeline

Create a compute pipeline from a shader. Returns a **raw `GPUComputePipeline`** — a pipeline
is usable as-is, so there is nothing to wrap and nothing to `destroy()` (the garbage
collector reclaims it). Call it as `createComputePipeline(ctx, desc)` or
`ctx.createComputePipeline(desc)`.

```js
const pipeline = ctx.createComputePipeline({ shader });
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shader` | [`Shader`](shader.md) | *(required)* | Shader with the compute module and bind-group layouts. |
| `entryPoint` | `string` | `"cs_main"` | Compute shader entry-point name. |

**Returns:** a `GPUComputePipeline`. Omitting `shader` throws.

The pipeline layout comes from the shader: if the shader declares bind groups it uses their
explicit layout, otherwise it falls back to `"auto"`.

!!! note "Compute visibility must be explicit"
    A binding's default visibility is `VERTEX | FRAGMENT`. Bindings used by a compute shader
    must set `visibility: GPUShaderStage.COMPUTE` in the shader's group descriptor, or the
    bind group won't match the pipeline. See the examples below.

---

## ComputePass

An open compute pass. You don't construct it directly — get one from `ctx.beginCompute()`
(standalone) or `frame.beginComputePass()` (embedded in a frame). The setter methods return
`this`, so calls chain.

### Public fields

| Field | Type | Description |
|-------|------|-------------|
| `encoder` | `GPUCommandEncoder` | The command encoder backing this pass. |
| `pass` | `GPUComputePassEncoder` | The active pass encoder (set to `null` after `end()`). |
| `ownsEncoder` | `boolean` | `true` for standalone passes — `end()` will finish and submit. |

### Methods

#### setPipeline

Set the active compute pipeline. Chainable.

```js
cp.setPipeline(pipeline);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pipeline` | `GPUComputePipeline` | Pipeline from [`createComputePipeline`](#createcomputepipeline). |

#### setBindGroup

Set a single bind group at an explicit index. Chainable.

```js
cp.setBindGroup(0, bindGroup);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `index` | `number` | Bind-group slot. |
| `bindGroup` | `GPUBindGroup` | The bind group. |

#### bind

Bind an array of groups, in order, starting at `firstIndex` — `groups[i]` goes to slot
`firstIndex + i`. Chainable. This is the compute-side counterpart of
[`Shader`](shader.md) binding.

```js
cp.bind([bindGroup]);          // → slot 0
cp.bind([bgA, bgB], 1);        // → slots 1 and 2
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groups` | `GPUBindGroup[]` | *(required)* | Bind groups to set, in slot order. |
| `firstIndex` | `number` | `0` | Slot of the first group. |

#### dispatch

Dispatch a grid of workgroups (calls `dispatchWorkgroups`). Chainable.

```js
cp.dispatch(N / 64);           // 1D
cp.dispatch(W / 8, H / 8);     // 2D grid
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `x` | `number` | *(required)* | Workgroup count in X. |
| `y` | `number` | `1` | Workgroup count in Y. |
| `z` | `number` | `1` | Workgroup count in Z. |

Counts are in **workgroups**, not threads — divide your element count by the
`@workgroup_size` declared in the WGSL.

#### end

End the pass.

```js
cp.end();
```

For a **standalone** pass (`ownsEncoder === true`), `end()` also finishes the encoder and
submits the command buffer. For an **embedded** pass, `end()` only closes the pass and
leaves the encoder to the frame — call it before opening the render pass.

---

## Examples

### Standalone compute with read-back

Compute-only work: upload storage buffers, dispatch, then copy the output into a mappable
buffer and read it back on the CPU.

```wgsl
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
```

```js
import { Context } from "./jgfx/index.js";

const N = 256; // dispatched as N/64 workgroups of 64

// All three bindings are COMPUTE-visible; the third is read_write.
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

const bufA   = ctx.createStorageBuffer(a);                 // Float32Arrays
const bufB   = ctx.createStorageBuffer(b);
const bufOut = ctx.createStorageBuffer(new Float32Array(N));
const bindGroup = shader.createBindGroupBuffers(0, [bufA, bufB, bufOut]);

// Standalone: owns its encoder, submits on end().
const cp = ctx.beginCompute();
cp.setPipeline(pipeline).bind([bindGroup]).dispatch(N / 64);
cp.end();

// Copy results into a mappable buffer, then read them back to the CPU.
const readback = ctx.createMappingBuffer(bufOut.size, N);
bufOut.copy(readback);
const result = new Float32Array(await readback.read());
```

!!! tip "Read-back"
    Storage buffers can't be mapped directly. Copy the output into a mapping buffer with
    `bufOut.copy(readback)`, then `await readback.read()`. See [Buffer](buffer.md) for the
    buffer helpers.

### Storage texture, compute → render (one submit)

The mixed path: a compute pass writes a **storage texture**, and a render pass in the *same
frame* samples it onto a fullscreen quad. Both passes share one encoder, and the frame owns
the single submit.

```wgsl
// compute: write into a write-only rgba8 storage texture
@group(0) @binding(0) var output : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params : Params;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id : vec3u) {
  let dims = textureDimensions(output);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  // ... compute color ...
  textureStore(output, id.xy, color);
}
```

```js
import { Context, Binding, createSampler } from "./jgfx/index.js";

const TEX = 512;

// Written by compute, sampled by render → needs BOTH usages.
const tex = ctx.createTexture({
  width: TEX,
  height: TEX,
  format: "rgba8unorm",
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});
const sampler = createSampler(ctx);

// Compute group: a write-only storage texture + a uniform, both COMPUTE-visible.
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
        { binding: 1, minBindingSize: 16, visibility: GPUShaderStage.COMPUTE },
      ],
    },
  ],
});

const computePipeline = ctx.createComputePipeline({ shader: computeShader });
const renderPipeline  = ctx.createPipeline({ shader: renderShader });

const computeBG = computeShader.createBindGroup(0, [
  { binding: 0, texture: tex },
  { binding: 1, buffer: paramsBuf },
]);
const renderBG = renderShader.createBindGroup(0, [
  { binding: 0, texture: tex },
  { binding: 1, sampler },
]);

function render() {
  const frame = ctx.beginEncoder();       // encoder only — no render pass yet
  if (frame) {
    // Pass 1 (compute): fill the storage texture, sharing the frame's encoder.
    const cp = frame.beginComputePass();
    cp.setPipeline(computePipeline)
      .bind([computeBG])
      .dispatch(TEX / 8, TEX / 8);
    cp.end();                             // ends the pass only — no submit

    // Pass 2 (render): sample the texture onto the surface.
    frame.beginRenderPass([0, 0, 0, 1]);
    frame.pass.setPipeline(renderPipeline);
    frame.pass.setBindGroup(0, renderBG);
    frame.pass.draw(6, 1, 0, 0);
    ctx.endFrame(frame);                  // the frame owns the single submit
  }
  requestAnimationFrame(render);
}
```

!!! note "Automatic storage-write → sample barrier"
    Because both passes run on one command encoder, WebGPU inserts the barrier between the
    compute pass's `textureStore` writes and the render pass's `textureSample` reads for
    you — the render pass always sees the freshly computed texture. No manual
    synchronization is needed.

!!! warning "One pass at a time"
    Only one pass encoder can be open on a command encoder at once. Close the compute pass
    (`cp.end()`) before opening the render pass. Run compute before or after the render
    pass, never nested inside it.

---

## See also

- [Shader](shader.md) — declaring compute bindings and building bind groups.
- [Buffer](buffer.md) — storage buffers, mapping buffers, and read-back.
- [Texture](texture.md) — storage textures and usage flags.
- [Frame](frame.md) — `beginEncoder`, `beginRenderPass`, and the frame submit.
- [Pipeline](pipeline.md) — the render-side pipeline counterpart.
