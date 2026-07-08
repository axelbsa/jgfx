# API Reference

jgfx is a small WebGPU wrapper exposed as plain ES modules. Everything is re-exported from
the barrel `jgfx/index.js`:

```js
// named classes and functions
import { Context, Shader, Mesh, math, geometry } from "./jgfx/index.js";

// or the single namespace object
import { Jgfx } from "./jgfx/index.js";
const ctx = await Jgfx.Context.create({ canvas });
```

## Modules

| Module | File | Description |
|--------|------|-------------|
| [Context](context.md) | `context.js` | WebGPU device, queue, canvas surface, and per-frame lifecycle |
| [Shader](shader.md) | `shader.js` | WGSL compilation, bind group layouts, pipeline layout |
| [Pipeline](pipeline.md) | `pipeline.js` | Render pipeline creation with zero-init defaults |
| [Frame](frame.md) | `context.js` | Per-frame begin/end cycle, multi-pass, MRT |
| [Buffer](buffer.md) | `buffer.js` | GPU buffers (vertex, index, uniform, storage, mapping) + async read |
| [Uniform](uniform.md) | `uniform.js` | Uniform buffer + bind group + data view bundle |
| [Mesh](mesh.md) | `mesh.js` | Standard vertex format, mesh creation, vertex layout, draw helpers |
| [Texture](texture.md) | `texture.js` | GPU texture + view, sampler, depth, per-layer writes |
| [Compute](compute.md) | `compute.js` | Compute pipeline and compute pass |
| [Camera](camera.md) | `camera.js` | Projection/view matrices with a GPU uniform |
| [Geometry](geometry.md) | `geometry.js` | Procedural cube / plane / sphere generators |
| [Math](math.md) | `math.js` | `mat4` / `vec3` / `quat` helpers — no external math library |
| [Easing](easing.md) | `easing.js` | The easings.net set of tweening functions |
| [Loader](loader.md) | `loader.js` | Load geometry from the LearnWebGPU text format (temporary) |

`math`, `geometry`, and `easing` are exposed as namespaces
(`import { math, geometry, easing }`). See the [Math reference](math.md) and its
[guide](../guides/math-and-transforms.md); the [Geometry reference](geometry.md) and its
[Procedural Geometry guide](../guides/procedural-geometry.md); and the
[Easing reference](easing.md).

## Naming conventions

| Category | Convention | Example |
|----------|-----------|---------|
| Classes | `PascalCase` | `Context`, `Shader`, `Mesh`, `Camera` |
| Static factory functions | `camelCase` | `createPipeline`, `createSampler`, `loadMesh` |
| Context factory sugar | `ctx.create*` | `ctx.createShader`, `ctx.createMesh` |
| Enums / defaults | `PascalCase` object | `Binding.TEXTURE`, `Filter.LINEAR`, `Defaults.WIDTH` |

Most types offer two equivalent entry points: a constructor and a `Context` method.
`new Mesh(ctx, verts, indices)` and `ctx.createMesh(verts, indices)` do the same thing —
the sugar just reads more fluently.

## Zero-init convention

Descriptors are plain objects designed so the minimal form maps to sensible defaults.
Omitted fields (`undefined`) resolve to documented values during creation:

```js
// defaults: preferred format, premultiplied alpha, no depth buffer
await Context.create({ canvas });

// override only what you need
await Context.create({ canvas, width: 1920, height: 1080, depthBuffer: true });

// defaults: triangle list, no cull, opaque, vs_main/fs_main
ctx.createPipeline({ shader });
```

Unlike cgfx (where `limits` must be initialized with `cgfx_default_limits()`), jgfx's
`requiredLimits` defaults to `{}` — "no preference" — which is already the right default.

## Error handling

jgfx uses two mechanisms:

- **Thrown `Error`s** for programmer/setup mistakes that should stop you immediately —
  missing `canvas`, no WebGPU support, a failed `fetch`, a bind group index out of range.
  Wrap `main()` in a `try/catch` (the examples do) to surface these on the page.
- **`.ok` fields** on objects that bundle GPU resources (`Buffer`, `Uniform`, `Mesh`,
  `Texture`, `Shader`) — a quick success flag, mirroring cgfx's `bool` returns.

Device-level problems surface through callbacks registered at `Context.create`: an
`uncapturederror` handler and `device.lost`, both defaulting to `console.error` (override
with `onDeviceError` / `onDeviceLost`). WGSL compile errors are logged automatically via
`getCompilationInfo()`.

```js
try {
  const ctx = await Context.create({ canvas });
} catch (e) {
  // e.g. "[jgfx] WebGPU is not available in this browser"
}
```

## Ownership conventions

The object that creates a GPU resource provides a matching `destroy()`:

| Resource | Created by | Released by |
|----------|-----------|-------------|
| `Context` | `Context.create` | `ctx.destroy()` |
| `Shader` | `ctx.createShader` / `Shader.fromFile` | `shader.destroy()` |
| `Buffer` | `ctx.create*Buffer` / `Buffer.*` | `buffer.destroy()` |
| `Uniform` | `ctx.createUniform` | `uniform.destroy()` |
| `Mesh` | `ctx.createMesh` / `loadMesh` | `mesh.destroy()` |
| `Texture` | `ctx.createTexture` | `texture.destroy()` |
| `Camera` | `ctx.createCamera` | `camera.destroy()` |
| `GPURenderPipeline` | `ctx.createPipeline` | GC (no wrapper) |
| `GPUSampler` | `ctx.createSampler` | GC (no wrapper) |
| `GPUBindGroup` | `shader.createBindGroup*` | GC (caller-owned) |

!!! note "GC vs. explicit destroy"
    WebGPU objects are ultimately garbage-collected, so raw handles (pipelines, samplers,
    bind groups) have no wrapper to destroy. jgfx still provides `destroy()` on the
    resource-owning classes for deterministic cleanup when you churn resources at runtime —
    call it in reverse creation order, before `ctx.destroy()`.

!!! warning "Bind groups are caller-owned"
    Bind groups from `shader.createBindGroup` / `createBindGroupBuffers` are **not**
    released by `shader.destroy()`. `Uniform` manages its internal bind group in
    `uniform.destroy()`.

## Transparent objects

Every jgfx object has public fields holding its raw handles. Read them and use the full
WebGPU API for anything jgfx doesn't wrap:

```js
const ctx = await Context.create({ canvas });

const device = ctx.device;               // GPUDevice
const queue  = ctx.queue;                // GPUQueue
const layout = shader.groupLayouts[0];   // GPUBindGroupLayout
```
