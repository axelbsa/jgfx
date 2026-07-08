# Pipeline

Render pipeline creation with sensible defaults.

**File:** `pipeline.js`

`createPipeline` returns a **raw `GPURenderPipeline`** — exactly the object
WebGPU hands back. A pipeline is already usable as-is, so there is nothing to
wrap. Every descriptor field except `shader` is optional; omitted fields take the
same defaults as cgfx (triangle-list, CCW, no cull, opaque, single surface
target).

!!! note "No wrapper, no destroy"
    Because the return value is a plain `GPURenderPipeline`, it is
    garbage-collected — there is no `destroy()` to call. Just drop the reference
    when you are done.

---

## createPipeline

Create a render pipeline. Also available as the standalone function
`createPipeline(ctx, desc)`.

```js
const pipeline = ctx.createPipeline(desc);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `desc` | `object` | Pipeline configuration (see below). The only required field is `shader`. |

**Returns** a `GPURenderPipeline`. **Throws** if `desc.shader` is missing.

### Descriptor fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shader` | `Shader` | *(required)* | Shader providing the module and layouts. |
| `vertexEntry` | `string` | `"vs_main"` | Vertex shader entry point. |
| `fragmentEntry` | `string` | `"fs_main"` | Fragment shader entry point. |
| `topology` | `GPUPrimitiveTopology` | `"triangle-list"` | Primitive topology. Strip topologies auto-set `stripIndexFormat: "uint32"`. |
| `cullMode` | `GPUCullMode` | `"none"` | Face culling mode. |
| `frontFace` | `GPUFrontFace` | `"ccw"` | Front-face winding order. |
| `depthTest` | `boolean` | `false` | Enable depth testing. When `false`, no depth/stencil state is attached. |
| `depthFormat` | `GPUTextureFormat` | `"depth24plus"` | Depth format (only when `depthTest` is `true`). |
| `depthCompare` | `GPUCompareFunction` | `"less"` | Depth compare function (only when `depthTest` is `true`). |
| `depthWriteDisabled` | `boolean` | `false` | `true` = depth test without writing depth. `false` = depth writes enabled. |
| `sampleCount` | `number` | `1` | MSAA sample count. |
| `alphaToCoverage` | `boolean` | `false` | Enable alpha-to-coverage. |
| `vertexLayouts` | `GPUVertexBufferLayout[]` | `[]` | Vertex buffer layouts. Use [`Mesh.vertexLayout()`](mesh.md) for the standard vertex. |
| `colorTargets` | `object[]` | single surface target | Color target array — see below. |

### Color targets

Each entry of `colorTargets` describes one fragment `@location` output:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | `GPUTextureFormat` | `ctx.format` | Target texture format. Defaults to the context's surface format. |
| `blend` | `GPUBlendState` | *(none)* | Blend state. Omit for an opaque target. |
| `writeMask` | `GPUColorWriteFlags` | `GPUColorWrite.ALL` | Channel write mask. |

When `colorTargets` is omitted, the pipeline gets a single opaque target at
`ctx.format`. Supply an array for per-target blending, offscreen formats, or
multiple render targets (MRT). Up to `MAX_COLOR_TARGETS` (8) attachments are
supported.

!!! info "Layout comes from the shader"
    The pipeline layout is read from `shader.pipelineLayout`. When the shader has
    no bind groups that field is `null`, and the pipeline falls back to WebGPU's
    automatic layout (`layout: "auto"`).

---

## Blend presets

Helper functions returning a ready-made `GPUBlendState`. Pass one as a color
target's `blend` field.

### blendAlpha

Straight alpha blending: `src-alpha` / `one-minus-src-alpha`.

```js
import { blendAlpha } from "./jgfx/index.js";
```

### blendAdditive

Additive blending: `one` / `one`. Good for particles and glow.

```js
import { blendAdditive } from "./jgfx/index.js";
```

### blendPremultiplied

Premultiplied alpha: `one` / `one-minus-src-alpha`. For compositing
pre-blended textures.

```js
import { blendPremultiplied } from "./jgfx/index.js";
```

```js
const pipeline = ctx.createPipeline({
  shader,
  colorTargets: [{ blend: blendAlpha() }],
});
```

---

## Usage

### Minimal pipeline (no vertex buffers)

Vertices are generated in the shader from `@builtin(vertex_index)`.

```js
const shader = ctx.createShader("triangle", wgsl);
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

### Depth testing with vertex buffers

Requires a context created with `depthBuffer: true`. Use
[`Mesh.vertexLayout()`](mesh.md) for the standard vertex format.

```js
const ctx = await Context.create({ canvas, depthBuffer: true });

const pipeline = ctx.createPipeline({
  shader,
  depthTest: true,
  cullMode: "back",
  vertexLayouts: [Mesh.vertexLayout()],
});
```

!!! warning "Depth buffer must be enabled on the context"
    Setting `depthTest: true` without creating a depth buffer on the context
    (`depthBuffer: true` in the [context](context.md) descriptor) results in a
    WebGPU validation error.

### Multiple render targets (MRT)

One pipeline writing two offscreen `rgba8unorm` targets, matched by a fragment
shader with two `@location` outputs:

```js
const mrtPipeline = ctx.createPipeline({
  shader: mrtShader,
  colorTargets: [{ format: "rgba8unorm" }, { format: "rgba8unorm" }],
});

// The present pass uses the default single surface-format target.
const presentPipeline = ctx.createPipeline({ shader: presentShader });
```

See the **mrt** example for the full multi-pass frame, and the
[Shader](shader.md) reference for building the bind group layouts a pipeline
consumes.
