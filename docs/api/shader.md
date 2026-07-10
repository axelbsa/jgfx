# Shader

WGSL compilation, bind group layout management, and bind group helpers.

**File:** `shader.js`

A `Shader` owns three things: the compiled WGSL **module**, the **bind group
layouts** (one per `@group(N)`), and the **pipeline layout** built from them.
The caller owns the bind groups and buffers it creates *from* those layouts.
This ownership split is what enables the "same shader, different uniforms per
object" pattern.

!!! info "Ownership split"
    A shader owns its **layouts**; the caller owns its **bind groups**.
    `shader.destroy()` releases the module, pipeline layout, and group layouts —
    it does **not** free any bind group you created. See the
    [Shader & Bind Groups](../guides/shader-bind-groups.md) guide for the full
    model.

---

## Creating a shader

### ctx.createShader

Compile a WGSL source string and, optionally, build bind group layouts from a
descriptor. Also available as the standalone constructor `new Shader(ctx, label,
wgsl, desc)`.

```js
const shader = ctx.createShader(label, wgsl, desc);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | `string` | Debug label for the shader module. |
| `wgsl` | `string` | WGSL source code. |
| `desc` | `object` \| `undefined` | Bind group layout description. Omit for a shader with no bindings. |

The `desc` shape is `{ groups: GroupDesc[] }`, where each group is
`{ bindings: BindingDesc[] }`, indexed by `@group(N)`. See
[Descriptor shape](#descriptor-shape) below.

**Returns** a [`Shader`](#public-fields). When `desc` is omitted or has no
groups, only the module is created and `pipelineLayout` stays `null` (the
pipeline will then use WebGPU's automatic layout).

```js
// No bindings — vertices generated in the shader.
const shader = ctx.createShader("triangle", wgsl);
```

```js
// One uniform at @group(0) @binding(0).
const shader = ctx.createShader("uniforms", wgsl, {
  groups: [{ bindings: [{ binding: 0, minBindingSize: 32 }] }],
});
```

!!! note "The descriptor is checked against your WGSL"
    The constructor parses the WGSL and compares it with the `groups` descriptor:
    missing or mistyped bindings, undersized `minBindingSize` (with the computed
    struct layout shown field by field), wrong storage-texture formats, and
    visibility that excludes a referencing stage. Mismatches **throw a
    `JgfxError`** at the call site by default; pass
    `Context.create({ validation: "warn" })` to log-and-continue instead, or
    `"off"` to skip the check. The descriptor stays authoritative — jgfx never
    generates layouts from the WGSL.

!!! tip "Await `shader.validate()` for compile errors"
    WGSL *compile* results arrive asynchronously from the browser. Call
    `await shader.validate()` after creating a shader you are actively editing:
    it resolves when the module compiled cleanly and throws a `JgfxError`
    listing every error as `label:line:col` otherwise.

---

### ctx.createShaderFromFile

Fetch WGSL from a URL, then create the shader. Also available as the static
`Shader.fromFile(ctx, label, url, desc)`. Because it fetches, it is **async**.

```js
const shader = await ctx.createShaderFromFile(label, url, desc);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | `string` | Debug label for the shader module. |
| `url` | `string` | URL of the `.wgsl` source file. |
| `desc` | `object` \| `undefined` | Bind group layout description, as in `createShader`. |

**Returns:** `Promise<Shader>`. **Throws** if the fetch fails (e.g. 404).

```js
const shader = await ctx.createShaderFromFile("mesh", "./mesh.wgsl", {
  groups: [{ bindings: [{ binding: 0, minBindingSize: 64 }] }],
});
```

---

## Descriptor shape

The descriptor mirrors WGSL's `@group(N) @binding(M)` structure:

```js
{
  groups: [                       // groups[N] describes @group(N)
    { bindings: [ /* BindingDesc */ ] },
  ],
}
```

### BindingDesc

Describes one binding slot within a group. Only the fields relevant to the
binding's `kind` are read; the rest fall back to per-kind defaults.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `binding` | `number` | — | The `@binding(N)` index in WGSL. |
| `kind` | `string` | `Binding.BUFFER` | Resource kind. One of the [`Binding`](#binding-enum) values. |
| `visibility` | `GPUShaderStageFlags` | per-kind (see below) | Shader stages that can access the binding. |
| `type` | `GPUBufferBindingType` | `"uniform"` | Buffer binding type (`BUFFER` only). |
| `hasDynamicOffset` | `boolean` | `false` | Buffer uses a dynamic offset at bind time (`BUFFER` only). |
| `minBindingSize` | `number` | *(none)* | Minimum buffer size in bytes (`BUFFER` only). Omit for no minimum. |
| `sampleType` | `GPUTextureSampleType` | `"float"` | Texture sample type (`TEXTURE` only). |
| `viewDimension` | `GPUTextureViewDimension` | `"2d"` | View dimension (`TEXTURE` and `STORAGE_TEXTURE`). |
| `samplerType` | `GPUSamplerBindingType` | `"filtering"` | Sampler binding type (`SAMPLER` only). Use `"comparison"` for shadow maps, `"non-filtering"` for data textures. |
| `storageAccess` | `GPUStorageTextureAccess` | `"write-only"` | Storage texture access (`STORAGE_TEXTURE` only). |
| `storageFormat` | `GPUTextureFormat` | *(required)* | Storage texture format (`STORAGE_TEXTURE` only). |

### Binding enum

The `kind` field takes a value from the exported `Binding` enum:

| Value | String | Description |
|-------|--------|-------------|
| `Binding.BUFFER` | `"buffer"` | Buffer (uniform, storage, read-only storage). The default kind. |
| `Binding.TEXTURE` | `"texture"` | Sampled texture. |
| `Binding.SAMPLER` | `"sampler"` | Sampler. |
| `Binding.STORAGE_TEXTURE` | `"storage-texture"` | Storage texture (compute read/write). |

### Default visibility

When `visibility` is omitted, jgfx picks a sensible default from the `kind`:

| Kind | Default visibility |
|------|--------------------|
| `Binding.BUFFER` | `VERTEX \| FRAGMENT` |
| `Binding.TEXTURE` | `FRAGMENT` |
| `Binding.SAMPLER` | `FRAGMENT` |
| `Binding.STORAGE_TEXTURE` | `COMPUTE` |

```js
import { Binding } from "./jgfx/index.js";

// @group(0): mvp uniform. @group(1): texture + sampler.
const shader = ctx.createShader("textured", wgsl, {
  groups: [
    { bindings: [{ binding: 0, minBindingSize: 64 }] },
    {
      bindings: [
        { binding: 0, kind: Binding.TEXTURE },
        { binding: 1, kind: Binding.SAMPLER },
      ],
    },
  ],
});
```

---

## Public fields

A `Shader` exposes its GPU objects directly:

| Field | Type | Description |
|-------|------|-------------|
| `module` | `GPUShaderModule` | The compiled WGSL module. |
| `groupLayouts` | `GPUBindGroupLayout[]` | One layout per `@group(N)`. Empty when the shader has no bindings. |
| `pipelineLayout` | `GPUPipelineLayout \| null` | Built from `groupLayouts`. `null` when no descriptor was provided (automatic layout). |
| `diagnostics` | `object[]` | Validator findings from construction time (empty when `validation: "off"`). |

---

## Creating bind groups

Bind groups are created from a shader's layouts but **owned by the caller** — a
shader owns layouts, not bind groups.

### shader.createBindGroupBuffers

Create a bind group of buffers for one group index, binding `buffers[i]` at
`@binding(i)`. Best when a group is all consecutive buffers.

```js
const bg = shader.createBindGroupBuffers(groupIndex, buffers);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `groupIndex` | `number` | The `@group(N)` index. |
| `buffers` | `Buffer[]` | jgfx [`Buffer`](uniform.md) objects; each is bound with `offset: 0` and its full `size`. |

**Returns** a `GPUBindGroup`. **Throws** if `groupIndex` is out of range.

!!! note "Non-consecutive or mixed bindings"
    `createBindGroupBuffers` assumes consecutive buffer bindings. For mixed
    resource types (textures, samplers) or explicit binding indices, use
    `createBindGroup` below.

### shader.createBindGroup

Create a bind group from explicit entries mixing buffers, textures, and
samplers. Set exactly one of `buffer`, `texture`, or `sampler` per entry.

```js
const bg = shader.createBindGroup(groupIndex, entries);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `groupIndex` | `number` | The `@group(N)` index. |
| `entries` | `object[]` | One entry per binding (see below). |

Each entry is:

| Field | Type | Description |
|-------|------|-------------|
| `binding` | `number` | The `@binding(N)` index. |
| `buffer` | `Buffer` | jgfx buffer for a buffer binding (uses `buffer.buffer`). |
| `texture` | `Texture` | jgfx [`Texture`](texture.md) for a texture binding (uses `texture.view`). |
| `sampler` | `GPUSampler` | Sampler for a sampler binding. |
| `offset` | `number` | Buffer sub-range offset in bytes. Defaults to `0`. |
| `size` | `number` | Buffer sub-range size in bytes. Defaults to the buffer's full `size`. |

**Returns** a `GPUBindGroup`. **Throws** if `groupIndex` is out of range or an
entry has no resource.

```js
// Texture + sampler at @group(1).
const texBG = shader.createBindGroup(1, [
  { binding: 0, texture },
  { binding: 1, sampler },
]);
```

---

## Binding during rendering

You can set a single bind group with the native `pass.setBindGroup(index, bg)`,
which is what the examples do:

```js
frame.pass.setPipeline(pipeline);
frame.pass.setBindGroup(0, mvp.bindGroup);
frame.pass.setBindGroup(1, texBG);
mesh.draw(frame.pass);
```

### bind

Standalone helper that binds an array of groups starting at `firstIndex`,
setting `groups[i]` to slot `firstIndex + i`. Works for render *or* compute
passes.

```js
import { bind } from "./jgfx/index.js";

bind(pass, groups, firstIndex);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pass` | `GPURenderPassEncoder` \| `GPUComputePassEncoder` | Active pass encoder. |
| `groups` | `GPUBindGroup[]` | Bind groups to set, in order. |
| `firstIndex` | `number` | First slot to bind to. Defaults to `0`. |

```js
// @group(0) = camera, @group(1) = material.
bind(frame.pass, [cameraGroup, materialGroup]);
```

---

## Cleanup

### shader.destroy

Release the shader's references. The GPU objects are garbage-collected, so this
mainly clears fields.

```js
shader.destroy();
```

!!! warning "Does NOT release bind groups"
    Bind groups you created with `createBindGroupBuffers` or `createBindGroup`
    are caller-owned and are **not** freed here. [`Uniform`](uniform.md) manages
    its own bind group for you. See the
    [Shader & Bind Groups](../guides/shader-bind-groups.md) guide.

---

## Usage

### Same shader, different uniforms per object

```js
import { Context } from "./jgfx/index.js";

const ctx = await Context.create({ canvas });

// One shader, one bind group: @group(0) @binding(0).
const shader = ctx.createShader("uniforms", wgsl, {
  groups: [{ bindings: [{ binding: 0, minBindingSize: 32 }] }],
});
const pipeline = ctx.createPipeline({ shader });

// Two objects, same layout, different data.
const uLeft = ctx.createUniform(shader, 0, leftData);
const uRight = ctx.createUniform(shader, 0, rightData);

function render() {
  const frame = ctx.beginFrame([0.1, 0.1, 0.15, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);
    frame.pass.setBindGroup(0, uLeft.bindGroup);
    frame.pass.draw(3);
    frame.pass.setBindGroup(0, uRight.bindGroup);
    frame.pass.draw(3);
    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

See the **multiple_uniforms** and **textured_quad** examples for full working
pages, and the [Pipeline](pipeline.md) reference for turning a shader into a
render pipeline.
