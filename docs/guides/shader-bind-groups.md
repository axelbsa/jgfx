# Shaders & Bind Groups

This guide explains how jgfx manages shader layouts and bind groups, and how to
use them to pass uniforms, textures, and samplers to your shaders. The whole
system rests on one clean ownership split: the **[Shader](../api/shader.md) owns
the bind group *layouts*; you own the bind *groups*** you create from them.

## The Ownership Model

When you create a shader, jgfx compiles the WGSL source and — from the descriptor
you pass — builds a set of bind group layouts plus a pipeline layout. These
layouts describe the *shape* of the data the shader expects. The actual data
(the bind groups and the buffers/textures behind them) is created separately and
belongs to you.

### What the Shader owns

A `Shader` holds exactly these GPU objects:

```js
shader.module          // GPUShaderModule — the compiled WGSL
shader.groupLayouts    // GPUBindGroupLayout[] — one per desc.groups[N]
shader.pipelineLayout  // GPUPipelineLayout — all group layouts combined (or null)
```

`groupLayouts[N]` corresponds to `@group(N)` in your WGSL. If the descriptor has
no groups, `groupLayouts` is empty and `pipelineLayout` is `null` — the pipeline
then falls back to WebGPU's automatic layout inference.

### What you own

Everything created *from* a layout:

- The `GPUBindGroup` objects returned by `shader.createBindGroup` /
  `shader.createBindGroupBuffers`, or bundled inside a
  [Uniform](../api/uniform.md).
- The buffers and textures those bind groups reference.
- The CPU-side `TypedArray` data you upload into them.

Because many bind groups can be built from the same layout, one shader and one
pipeline can drive an entire scene of objects, each with its own data. That is
the foundation of the [same-shader pattern](#the-same-shader-different-uniforms-pattern)
below.

!!! warning "Bind groups are NOT freed by `shader.destroy()`"
    `shader.destroy()` releases only the module, pipeline layout, and group
    layouts. The bind groups, buffers, and [Uniform](../api/uniform.md) objects
    you created from those layouts are yours to release — call their own
    `destroy()` **before** destroying the shader that owns their layout.

## Describing the Layout

A shader descriptor is a plain object whose only field is `groups`, an array
indexed by `@group(N)`. Each group has a `bindings` array, and each entry is a
**BindingDesc** describing one `@binding(M)` slot:

```js
const shader = ctx.createShader("label", wgsl, {
  groups: [
    // @group(0)
    { bindings: [ /* BindingDesc, BindingDesc, ... */ ] },
    // @group(1)
    { bindings: [ /* ... */ ] },
  ],
});
```

### BindingDesc fields

Every field is optional except `binding` (and `storageFormat` for storage
textures). The `kind` selects which of the remaining fields apply:

| Field | Applies to | Default | Meaning |
|-------|-----------|---------|---------|
| `binding` | all | — | the `@binding(M)` index (required) |
| `kind` | all | `Binding.BUFFER` | which `Binding.*` resource kind (below) |
| `visibility` | all | per-kind (below) | `GPUShaderStage.*` flags |
| `type` | buffer | `"uniform"` | `"uniform"` \| `"storage"` \| `"read-only-storage"` |
| `hasDynamicOffset` | buffer | `false` | enable dynamic offsets |
| `minBindingSize` | buffer | none | minimum buffer size (validation) |
| `sampleType` | texture | `"float"` | e.g. `"float"`, `"depth"`, `"uint"` |
| `viewDimension` | texture / storage texture | `"2d"` | `"2d"`, `"2d-array"`, `"3d"`, … |
| `samplerType` | sampler | `"filtering"` | e.g. `"filtering"`, `"non-filtering"`, `"comparison"` |
| `storageAccess` | storage texture | `"write-only"` | `"write-only"` \| `"read-only"` \| `"read-write"` |
| `storageFormat` | storage texture | — | texel format, e.g. `"rgba8unorm"` (required) |

### Binding kinds and their default visibility

`Binding` (from `constants.js`) has four kinds. When you omit `visibility`, jgfx
picks a sensible default per kind:

| `Binding.*` | Value | Default visibility |
|-------------|-------|--------------------|
| `BUFFER` | `"buffer"` | `VERTEX | FRAGMENT` |
| `TEXTURE` | `"texture"` | `FRAGMENT` |
| `SAMPLER` | `"sampler"` | `FRAGMENT` |
| `STORAGE_TEXTURE` | `"storage-texture"` | `COMPUTE` |

These defaults are tuned for the common case — uniforms read in both stages,
textures/samplers sampled in the fragment stage, storage textures written from
compute. When your usage differs (most importantly, **compute-stage buffers**),
set `visibility` explicitly:

```js
{ binding: 0, type: "read-only-storage", visibility: GPUShaderStage.COMPUTE }
```

!!! tip "`minBindingSize`"
    Setting `minBindingSize` to your struct's byte size turns on validation —
    WebGPU errors if you bind a buffer smaller than the shader expects, catching
    a whole class of layout bugs early. It is optional but recommended.

### Mapping WGSL to the descriptor

The descriptor mirrors the WGSL declarations one-to-one:

```wgsl
struct MyUniforms { color: vec4f, offset: vec4f };
@group(0) @binding(0) var<uniform> u: MyUniforms;
```

```js
ctx.createShader("uniforms", wgsl, {
  groups: [{ bindings: [{ binding: 0, minBindingSize: 32 }] }],
});
```

`kind` defaults to `Binding.BUFFER` and `type` to `"uniform"`, so a plain uniform
buffer needs nothing but its `binding` (and, ideally, `minBindingSize`).

### Shaders with no bindings

If a shader has no `@group`/`@binding` declarations, omit the descriptor entirely:

```js
const shader = ctx.createShader("triangle", wgsl); // no third argument
```

`groupLayouts` stays empty, `pipelineLayout` is `null`, and the pipeline uses
automatic layout inference. Note the corollary: you **cannot** create bind groups
from an auto-inferred layout, so if your WGSL *does* declare bindings, you must
describe them here even if you only want the layouts.

## The "Same Shader, Different Uniforms" Pattern

This is the most important pattern in jgfx. One shader, one pipeline, many
objects — each with its own per-object uniform data. You get there by creating
several [Uniform](../api/uniform.md) objects from the same shader layout.

A `Uniform` bundles three things: a GPU buffer, a bind group built from the
shader's layout, and a **reference to your `TypedArray`**. The array stays yours:
mutate it in place, then call `write()` to upload the current contents.

```js
const wgsl = /* wgsl */ `
struct MyUniforms {
  color:  vec4f,
  offset: vec4f,   // xy = position, z = rotation angle
};
@group(0) @binding(0) var<uniform> u: MyUniforms;

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // ... rotate a hardcoded triangle by u.offset.z, translate by u.offset.xy ...
}
@fragment fn fs_main() -> @location(0) vec4f { return u.color; }
`;

// One shader with one bind group: @group(0) @binding(0).
const shader = ctx.createShader("uniforms", wgsl, {
  groups: [{ bindings: [{ binding: 0, minBindingSize: 32 }] }],
});
const pipeline = ctx.createPipeline({ shader });
```

Now create one `Uniform` per object. Each owns its own buffer and bind group but
shares the shader's single layout. The backing arrays are plain `Float32Array`s
laid out as `[r, g, b, a, ox, oy, rot, _pad]`:

```js
const left  = new Float32Array([1.0, 0.3, 0.3, 1.0, -0.4, 0, 0, 0]);
const right = new Float32Array([0.3, 0.5, 1.0, 1.0,  0.4, 0, 0, 0]);

const uLeft  = ctx.createUniform(shader, 0, left);  // group index 0
const uRight = ctx.createUniform(shader, 0, right);
```

Each frame, mutate the arrays in place and `write()` before you draw. Set the
pipeline once, then swap bind groups between draw calls:

```js
let t = 0;
function render() {
  t += 0.016;
  left[6]  = t;         // rotation, written straight into the backing array
  right[6] = -t * 0.7;
  uLeft.write();        // upload the current bytes of `left`
  uRight.write();

  const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);

    frame.pass.setBindGroup(0, uLeft.bindGroup);   // draw the left triangle
    frame.pass.draw(3);

    frame.pass.setBindGroup(0, uRight.bindGroup);  // draw the right triangle
    frame.pass.draw(3);

    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

### Why this works

1. **One shader** builds the layout for `@group(0)`.
2. **One pipeline** is created from that shader.
3. **Two `Uniform`s** each allocate their own buffer + bind group from that same
   layout, but point at different arrays.
4. **Each frame**, `write()` uploads each array's current bytes.
5. **During the pass**, `setBindGroup(0, …)` chooses which uniform the *next*
   draw sees. Set the pipeline once; alternate the bind group per object.

!!! note "You keep the data"
    A `Uniform` stores a reference to your `TypedArray` (`uniform.data`), it does
    not copy it. Mutating the array and calling `write()` is the whole update
    loop. `uniform.data.set(...)` is handy for writing a computed matrix in one
    shot (see [Frame](../api/frame.md)-driven examples).

## Multiple Groups

Split resources that update at different rates into different `@group`s — for
example a per-frame camera at `@group(0)` and a per-object texture set at
`@group(1)`. The descriptor lists one entry per group, in order:

```wgsl
struct U { mvp: mat4x4f };
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
```

```js
const shader = ctx.createShader("textured", wgsl, {
  groups: [
    { bindings: [{ binding: 0, minBindingSize: 64 }] },  // @group(0): mvp uniform
    {                                                     // @group(1): texture + sampler
      bindings: [
        { binding: 0, kind: Binding.TEXTURE },
        { binding: 1, kind: Binding.SAMPLER },
      ],
    },
  ],
});
```

At draw time each group binds to its own slot:

```js
frame.pass.setBindGroup(0, mvp.bindGroup);  // the Uniform for @group(0)
frame.pass.setBindGroup(1, texBG);          // the mixed group for @group(1)
```

## Creating Bind Groups

jgfx gives you two ways to build a bind group, matching the two common cases.

### Buffer-only groups: `createBindGroupBuffers`

When a group is nothing but buffers at consecutive bindings, pass an array of
jgfx `Buffer` objects. `buffers[i]` binds at `@binding(i)`:

```js
// @group(0) has three storage buffers at @binding(0..2)
const bindGroup = shader.createBindGroupBuffers(0, [bufA, bufB, bufOut]);
```

This is exactly what [Uniform](../api/uniform.md) uses internally — it wraps a
single buffer bound at `@binding(0)`.

### Mixed groups: `createBindGroup`

When a group mixes buffers, textures, and samplers (or uses non-consecutive
bindings), pass explicit entries. Each entry has a `binding` plus **exactly one**
resource — `buffer`, `texture`, or `sampler`:

```js
const texBG = shader.createBindGroup(1, [
  { binding: 0, texture },   // a jgfx Texture — its .view is used
  { binding: 1, sampler },   // a raw GPUSampler from createSampler()
]);
```

How each resource kind is resolved:

- **`buffer`** — a jgfx `Buffer`; jgfx binds `buffer.buffer` at `offset` (default
  `0`) with `size` (default `buffer.size`). Both are overridable per entry.
- **`texture`** — a jgfx [Texture](../api/texture.md); jgfx binds its `.view`.
- **`sampler`** — a raw `GPUSampler` (as returned by `ctx.createSampler`); it is
  bound directly.

A full texture-and-sampler example — one `Uniform` for the matrix, one mixed
group for the material:

```js
const texture = ctx.createTexture({ width: 256, height: 256 });
texture.write(pixels);                 // upload RGBA8 pixels once
const sampler = ctx.createSampler();   // linear + clamp-to-edge defaults

const mvp   = ctx.createUniform(shader, 0, new Float32Array(16));
const texBG = shader.createBindGroup(1, [
  { binding: 0, texture },
  { binding: 1, sampler },
]);

// in the loop:
frame.pass.setPipeline(pipeline);
frame.pass.setBindGroup(0, mvp.bindGroup);
frame.pass.setBindGroup(1, texBG);
mesh.draw(frame.pass);
```

!!! tip "`bind()` helper"
    `shader.js` also exports a `bind(pass, groups, firstIndex = 0)` helper that
    sets an array of groups at consecutive slots starting from `firstIndex`. It
    works for render *and* compute passes, and is what the compute pass's
    `.bind([...])` method uses under the hood.

## Cleanup

Bind groups outlive nothing automatically — release your own resources first,
then the shader whose layout they depend on, then the context:

```js
uLeft.destroy();     // Uniform.destroy() releases its buffer + bind group
uRight.destroy();
texture.destroy();
shader.destroy();    // now safe: no live bind groups depend on its layouts
ctx.destroy();
```

GPU objects are garbage-collected, so for a page that runs until the tab closes
you can skip this. The explicit `destroy()` calls matter when you create and
discard resources at runtime (reloading a scene, resizing offscreen targets).

## See Also

- [Uniform](../api/uniform.md) — the buffer + bind group + data bundle.
- [Texture](../api/texture.md) — textures and samplers for mixed groups.
- [Shader](../api/shader.md) — the full layout-owning API.
- [Compute Pipeline & Render-to-Texture](compute-pipeline.md) — the same
  descriptor system applied to compute shaders and storage resources.
