# jgfx — JavaScript port of cgfx

A browser-only, plain-ESM, class-based port of [`cgfx`](../../C/webgpucppv2/cgfx) — a
convenience wrapper around WebGPU. This document is the full plan: the design, the
API mapping, and a phased implementation roadmap. We build it incrementally, but the
whole target is written down here so we always have something to work against.

---

## 1. Goals & non-goals

**Goal.** Port every cgfx module to idiomatic JavaScript classes while preserving the
*mental model* so anyone who knows cgfx recognises jgfx instantly. Same concepts, same
module boundaries, same "thin wrapper that gets out of the way" philosophy.

**What we keep (the good ideas):**

- **Module-per-concept.** One class/file per cgfx module (`Context`, `Shader`,
  `Pipeline`, `Buffer`, `Texture`, `Uniform`, `Mesh`, `Camera`, plus frame/compute).
- **Transparency / escape hatches.** Every wrapper exposes its raw WebGPU handle as a
  public field (`ctx.device`, `shader.module`, `buffer.buffer`, `mesh.vertexBuffer`,
  …). When jgfx doesn't wrap something, drop to raw WebGPU using these. This is the
  single most important property to preserve.
- **Zero-init defaults.** Every descriptor is a plain object where every field is
  optional and `undefined` means "sensible default" (`??` fallbacks internally).
  `ctx.createPipeline({ shader })` gives triangle-list / CCW / no-cull / opaque.
- **No global state.** Everything hangs off a `Context` instance; no singletons.
- **Caller-owned loop.** jgfx never calls `requestAnimationFrame`. The user drives the
  loop and calls `beginFrame` / `endFrame` (see §4, "Frame style").
- **Explicit lifetime.** `destroy()` methods mirror `cgfx_*_destroy`. (GC would
  eventually reclaim, but explicit destroy matches cgfx and frees GPU memory promptly.)
- **Standard 96-byte vertex** and a single reusable mesh vertex layout.

**Decisions (already made):**

| Decision | Choice |
|---|---|
| API shape | Idiomatic **classes** (same concepts, not identical names) |
| Language | **Plain JavaScript (ESM)**, no build step |
| Runtime | **Browser only** (canvas + `navigator.gpu`) |
| Math library | **Tiny built-in** `math.js` (only what Camera needs) |
| Frame style | **Explicit `beginFrame` / `endFrame`**; user owns `requestAnimationFrame` |
| Scope | **Full port**, delivered in phases (§7) |

**Non-goals / things that don't port cleanly:**

- **`external_window`** — In the browser the canvas *is* the surface. This "example"
  folds into normal `Context.create({ canvas })`; no separate path.
- **Slang** (`slang_triangle`) — needs a native Slang compiler. Out of scope; jgfx is
  WGSL-only. (A future wasm-Slang path could be added but is not planned here.)
- **GLFW / windowing** — replaced by a canvas element + browser event listeners.
- **Static/shared library build modes** — irrelevant; ESM modules are the unit.

---

## 2. Language & environment mapping

| cgfx (C23) | jgfx (JS/browser) |
|---|---|
| `cgfx_ctx_init(&ctx, &desc)` out-param, returns bool | `await Context.create(desc)` → `Context` (async: adapter/device are Promises) |
| `.ok` field on structs | Constructors **throw** on fatal failure; shader compile errors surfaced async (see §5) |
| Compound literal `&(CgfxDesc){ .x = 1 }` | Plain object `{ x: 1 }` with defaulted fields |
| `cgfx_*_destroy(&obj)` | `obj.destroy()` |
| Raw `WGPU*` handles in structs | Raw `GPU*` objects as public fields |
| `while (cgfx_ctx_is_running)` + `glfwPollEvents` | user's `requestAnimationFrame` loop |
| `cgfx_buffer_read` (blocking) | `await buffer.read()` (async `mapAsync`) |
| `wgpuDevicePoll` / `wgpuDeviceTick` / `wgpuSurfacePresent` | none — browser presents automatically (dropped from `endFrame`) |
| cglm `mat4` / `vec3` | `Float32Array` via built-in `math.js` |
| pointer to user uniform data | reference to the user's `TypedArray` (mutate in place, then `write()`) |

**No build step.** Source is ESM served over HTTP. WebGPU needs a secure context, so
examples run from `http://localhost` (a Chromium-based browser, or any browser with
WebGPU enabled). Dev server: `python3 -m http.server` or `npx serve` from the repo root.

---

## 3. Repository layout

```
/home/axelbs/src/js/jgfx/
├── PLAN.md                  ← this file
├── README.md                ← quickstart, browser/server requirements
├── jgfx/                    ← the library (ESM, no build)
│   ├── index.js             ← barrel: re-exports classes + `Jgfx` namespace of statics
│   ├── context.js           ← Context (cgfx_ctx) + Frame lifecycle (cgfx_frame)
│   ├── shader.js            ← Shader + bind-group creation (cgfx_shader)
│   ├── pipeline.js          ← createPipeline + blend helpers (cgfx_pipeline)
│   ├── buffer.js            ← Buffer (cgfx_buffer)
│   ├── uniform.js           ← Uniform (cgfx_uniform)
│   ├── mesh.js              ← Mesh + vertex packing + layout (cgfx_mesh)
│   ├── texture.js           ← Texture + Sampler (cgfx_texture)
│   ├── camera.js            ← Camera (cgfx_camera)
│   ├── compute.js           ← compute pipeline + ComputePass (cgfx_compute)
│   ├── loader.js            ← LearnWebGPU text-mesh loader (cgfx_loader)
│   ├── math.js              ← tiny mat4/vec3 (replaces cglm)
│   └── constants.js         ← Filter/AddressMode/etc. + shared defaults
├── examples/                ← one folder per cgfx example (html + js [+ wgsl])
│   ├── index.html           ← menu linking every example
│   ├── triangle/
│   ├── vertex_attribute/
│   ├── multiple_uniforms/
│   ├── instanced_rendering/
│   ├── primitives/
│   ├── depth_texture/
│   ├── projection_matrices/
│   ├── playing_with_buffers/
│   ├── software_framebuffer/
│   ├── compute/
│   ├── compute_texture/
│   ├── mrt/
│   └── loading_from_file/
└── docs/                    ← ported prose docs (mirrors cgfx/docs structure)
```

`index.js` exports the classes as named exports **and** a `Jgfx` object holding the
statics (so both `import { Context } from './jgfx/index.js'` and
`import { Jgfx } from ...; Jgfx.blendAlpha()` work).

---

## 4. Public API design (the full target)

Types below are described in prose; no `.d.ts` (plain JS). All descriptor fields are
optional unless marked **required**; omitted fields take the noted default.

### 4.1 `Context`  (cgfx_ctx + cgfx_frame)

```js
static async create({
  canvas,            // required: HTMLCanvasElement
  width, height,     // default: canvas.width/height (or 1280x720)
  depthBuffer,       // default: false — create + track a depth texture
  presentMode,       // ignored in browser (kept for parity, no-op)
  requiredLimits,    // default: {} (adapter defaults)
  requiredFeatures,  // default: []
  powerPreference,   // default: 'high-performance'
  onDeviceError,     // uncaptured error callback
  onDeviceLost,      // device lost callback
}) -> Context
```

Public fields: `device`, `queue`, `context` (GPUCanvasContext), `canvas`, `format`
(preferred canvas format), `depthTexture` (Texture | null), `width`, `height`.

Methods:
- `resize(width, height)` — reconfigure canvas context + recreate depth texture.
- `destroy()` — release device/resources.
- **Frame lifecycle:**
  - `beginFrame(clearColor) -> Frame | null` = `cgfx_frame_begin` (acquire view,
    create encoder, begin single render pass to the canvas). Returns `null` if the
    surface is unavailable (rare in browser; keeps parity).
  - `endFrame(frame)` = `cgfx_frame_end` (end pass, finish encoder, submit).
  - `beginEncoder() -> Frame` = `cgfx_frame_begin_encoder` (encoder only, for
    multi-pass / compute-then-render).
- Factory methods (thin sugar so users don't import every class; each also has a
  standalone constructor):
  `createShader`, `createShaderFromFile`, `createPipeline`, `createComputePipeline`,
  `createBuffer` (+ typed variants), `createUniform`, `createMesh`, `createTexture`,
  `createSampler`, `createCamera`.

### 4.2 `Frame`  (cgfx_frame)

Returned by `beginFrame`/`beginEncoder`. Public fields: `encoder`, `pass`
(GPURenderPassEncoder | null), `targetView`.

Methods (for the multi-pass path):
- `beginRenderPass(clearColor)` = `cgfx_frame_begin_render_pass`
- `beginRenderPassEx({ colorViews, resolveViews, clearColor, depthView, noDepth })`
  = `cgfx_frame_begin_render_pass_ex` (offscreen / MRT / MSAA resolve)
- `endRenderPass()` = `cgfx_frame_end_render_pass`
- `beginComputePass() -> ComputePass` (records a compute pass on this frame's encoder)

Simple case: `beginFrame` already opened the pass, so you only touch `frame.pass`.

### 4.3 `Shader`  (cgfx_shader)

```js
new Shader(ctx, label, wgsl, desc)               // desc: { groups: [...] } | null
static async fromFile(ctx, label, url, desc)     // fetch() the WGSL
```
`desc.groups[i] = { bindings: [ BindingDesc ] }`, and
`BindingDesc = { binding (required), visibility?, kind?, type?, minBindingSize?,
hasDynamicOffset?, sampleType?, viewDimension?, samplerType?, storageAccess?,
storageFormat? }`. `kind` ∈ `Jgfx.Binding.{BUFFER,TEXTURE,SAMPLER,STORAGE_TEXTURE}`
(default BUFFER). Same descriptor tree as cgfx (`ShaderDesc → GroupDesc → BindingDesc`).

Public fields: `module`, `pipelineLayout`, `groupLayouts` (array), `ok`.
Methods:
- `createBindGroup(groupIndex, entries)` — entries are
  `{ binding, buffer?|texture?|sampler?, offset?, size? }` (= `cgfx_bind_group_create`).
- `createBindGroupBuffers(groupIndex, buffers)` — shorthand (= `..._create_buffers`).
- `destroy()`.

(Native `pass.setBindGroup(i, bg, offsets?)` covers `cgfx_shader_bind*`; we don't
re-wrap it, but `Jgfx.bind(pass, groups, firstIndex=0)` is provided for 1:1 parity
with `cgfx_shader_bind`.)

### 4.4 Pipeline  (cgfx_pipeline)

```js
ctx.createPipeline({
  shader,                 // required (Shader)
  vertexEntry,            // default 'vs_main'
  fragmentEntry,          // default 'fs_main'
  topology,               // default 'triangle-list'
  cullMode,               // default 'none'
  frontFace,              // default 'ccw'
  depthTest,              // default false
  depthFormat,            // default 'depth24plus'
  depthCompare,           // default 'less'
  depthWriteDisabled,     // default false
  sampleCount,            // default 1
  alphaToCoverage,        // default false
  vertexLayouts,          // default [] (GPUVertexBufferLayout[])
  colorTargets,           // default: single target = ctx.format, opaque
}) -> GPURenderPipeline     // returns the raw handle, like cgfx
```
`colorTargets[i] = { format?, blend?, writeMask? }` (= `CgfxColorTarget`).
Statics: `Jgfx.blendAlpha()`, `Jgfx.blendAdditive()`, `Jgfx.blendPremultiplied()`.

### 4.5 `Buffer`  (cgfx_buffer)

```js
Buffer.vertex(ctx, data, count)          // VERTEX|COPY_DST
Buffer.index(ctx, uint32Indices)         // INDEX|COPY_DST, count = length
Buffer.uniform(ctx, data)                // UNIFORM|COPY_DST
Buffer.storage(ctx, data)                // STORAGE|COPY_DST|COPY_SRC
Buffer.mapping(ctx, size, count)         // MAP_READ|COPY_DST
new Buffer(ctx, usage, data)             // generic
```
`data` is an `ArrayBuffer`/`TypedArray`. Public fields: `buffer`, `size`, `count`, `ok`.
Methods: `await read(size?)` → `ArrayBuffer` (async mapAsync); `copy(dst, size)`
(records + submits a copy); `destroy()`.

### 4.6 `Uniform`  (cgfx_uniform)

```js
new Uniform(ctx, shader, groupIndex, data)  // data: a TypedArray the user keeps
```
Holds `buffer` (Buffer), `bindGroup` (GPUBindGroup), `data` (the user's TypedArray),
`size`, `ok`. `write()` uploads `data` to the GPU (user mutates the array in place,
then calls `write()` — the JS analogue of cgfx's data pointer). `destroy()`.

### 4.7 `Mesh`  (cgfx_mesh)

Standard vertex (96 bytes), field → offset → shaderLocation:

| field | type | offset | location |
|---|---|---|---|
| position | f32×3 | 0 | 0 |
| normal | f32×3 | 12 | 1 |
| tangent | f32×4 | 24 | 2 |
| texcoord0 | f32×2 | 40 | 3 |
| texcoord1 | f32×2 | 48 | 4 |
| color | f32×4 | 56 | 5 |
| joints | u16×4 | 72 | 6 |
| weights | f32×4 | 80 | 7 |

```js
new Mesh(ctx, vertices, indices)   // vertices: array of {position, normal, ...} OR a packed ArrayBuffer
static packVertices(vertexObjects) -> ArrayBuffer   // handles the mixed f32/u16 layout
static vertexLayout() -> GPUVertexBufferLayout      // = cgfx_mesh_vertex_layout (stride 96)
```
Fields: `vertexBuffer` (Buffer), `indexBuffer` (Buffer), `indexCount`, `ok`.
Methods: `draw(pass)`, `drawInstanced(pass, n)`, `destroy()`.

### 4.8 `Texture` & Sampler  (cgfx_texture)

```js
new Texture(ctx, { width (required), height?, depth?, format?, dimension?,
                   mipLevels?, sampleCount?, usage?, viewDimension? })
```
Fields: `texture`, `view`, `format`, `width`, `height`, `depth`, `mipLevels`, `ok`.
Methods: `write(data)`, `writeLayer(layer, data)`, `destroy()`.
```js
ctx.createSampler({ magFilter?, minFilter?, mipmapFilter?, addressU?, addressV?,
                    addressW?, maxAnisotropy?, compare? }) -> GPUSampler
```
`Jgfx.Filter.{DEFAULT,NEAREST,LINEAR}`, `Jgfx.Address.{DEFAULT,CLAMP,REPEAT,MIRROR}` —
mirroring cgfx's custom enums so `undefined`/DEFAULT means Linear/ClampToEdge (not the
WebGPU "0 = nearest" trap).

### 4.9 `Camera`  (cgfx_camera)

```js
new Camera(ctx, { fovy?=45, nearZ?=0.01, farZ?=100, eye, center, up?=[0,1,0] })
```
Fields: `projection` (Float32Array 16), `view` (Float32Array 16), `buffer` (Buffer), `ok`.
Methods: `perspective(fovyDeg, aspect, nearZ, farZ)`, `lookAt(eye, center, up)`,
`write()`, `bind(pass, bindGroup, groupIndex)`, `destroy()`. Matrices from `math.js`
using **Z ∈ [0,1]** clip space (WebGPU convention; matches cglm's forced depth range).

### 4.10 Compute  (cgfx_compute)

```js
ctx.createComputePipeline({ shader, entryPoint?='cs_main' }) -> GPUComputePipeline
frame.beginComputePass() -> ComputePass            // uses frame.encoder
ctx.beginCompute() -> ComputePass                  // standalone (own encoder)
```
`ComputePass` fields: `encoder`, `pass`, `ownsEncoder`. Methods: `end()` (ends pass; if
it owns the encoder, submits). Native `pass.setPipeline/setBindGroup/dispatchWorkgroups`
used directly between begin/end.

### 4.11 `math.js` (internal)

Minimal, only what Camera needs: `mat4.perspective`, `mat4.ortho`, `mat4.lookAt`,
`mat4.multiply`, `mat4.identity`; `vec3` helpers (`sub`, `normalize`, `cross`, `dot`).
All operate on / return `Float32Array`. Z-to-one depth convention.

---

## 5. Error handling strategy

*(Revised post-port, 2026-07: the original plan kept `.ok` fields "for 1:1 familiarity".
That proved to be the one parity feature that lies — cgfx's ok is synchronously
truthful, but the JS one flipped asynchronously after `getCompilationInfo()`, so
checking it right after creation raced and passed for broken shaders. Removed in favor
of exceptions; this is a deliberate divergence from cgfx.)*

- **Everything jgfx detects throws `JgfxError`** — no `.ok` fields, no status returns.
  Fatal construction errors (no `navigator.gpu`, adapter/device failure), fetch
  failures, out-of-range bind group indices.
- **WGSL↔descriptor validation** (jgfx/wgsl.js): `createShader` parses the WGSL and
  checks the hand-written `groups` descriptor against it — sizes (with computed struct
  layouts), kinds, storage formats, visibility. Mismatches throw at the call site;
  `Context.create({ validation: 'warn' | 'off' })` relaxes this. The descriptor stays
  authoritative — layouts are never generated from WGSL (learning WGSL is the point).
- **Shader compilation** stays async (matches WebGPU): `await shader.validate()`
  throws a `JgfxError` with `label:line:col` per compile error.
- **`beginFrame()` still returns `null`** when the surface is unavailable — a
  per-frame skip condition, not an error (keeps cgfx parity).
- **`onDeviceError` / `onDeviceLost`** callbacks wired to `device.uncapturederror` and
  `device.lost` (= cgfx's device-error/lost callbacks).

---

## 6. Example ↔ example mapping

Every runnable cgfx example gets a browser twin (`index.html` + `main.js`, WGSL either
inline or fetched). This is both the deliverable and the acceptance test per phase.

| cgfx example | jgfx | Notes |
|---|---|---|
| triangle | ✅ | inline WGSL, no buffers |
| vertex_attribute | ✅ | vertex buffer + layout |
| multiple_attributes | ✅ | folded into vertex_attribute variant |
| multiple_uniforms | ✅ | `Uniform`, per-object bind groups |
| instanced_rendering | ✅ | instance buffer + `Camera`; scale count down for the web if needed |
| primitives | ✅ | procedural geometry helpers |
| depth_texture | ✅ | `depthBuffer: true` |
| projection_matrices | ✅ | `Camera` |
| playing_with_buffers | ✅ | `buffer.copy` + `await buffer.read` |
| software_framebuffer | ✅ | write `Uint8Array` → texture |
| compute | ✅ | storage buffers + async readback |
| compute_texture | ✅ | storage texture (Julia set) |
| mrt | ✅ | `beginRenderPassEx` multi-target |
| loading_from_file | ✅ | `fetch` WGSL + loader mesh |
| external_window | ➖ | N/A — canvas is the surface; folded into `Context.create` |
| slang_triangle | ➖ | out of scope (native Slang compiler); WGSL-only |

---

## 7. Phased roadmap

Each phase is independently shippable and ends with working examples that serve as its
acceptance test. Build order follows dependencies.

### Phase 0 — Scaffolding
- Repo structure (§3), `README.md` (browser + local-server requirements), dev-server
  note, `examples/index.html` menu, `constants.js` (enums + defaults), `index.js`
  barrel. No rendering yet.
- **Done when:** `npx serve` serves the menu page; imports resolve.

### Phase 1 — Core render path (triangle)
- `Context` (create/resize/destroy, `beginFrame`/`endFrame`), `Shader` (no-binding
  path), Pipeline (defaults, vertex layouts, blend helpers), `Frame`.
- Examples: **triangle**, **vertex_attribute**.
- **Done when:** both render in-browser; window resize works.

### Phase 2 — Buffers, uniforms, bind groups
- `Buffer` (all creators + `read`/`copy`), `Shader` bind-group descriptors +
  `createBindGroup`/`createBindGroupBuffers`, `Uniform`, dynamic-offset support.
- Examples: **multiple_uniforms**, **playing_with_buffers**.
- **Done when:** two objects share one shader/pipeline with distinct uniforms; buffer
  copy + async readback verified.

### Phase 3 — Mesh, math, camera
- `math.js`, `Mesh` (vertex packing, `vertexLayout`, draw/instanced), `Camera`, depth
  texture in `Context`, small procedural-geometry helpers (cube/plane/sphere).
- Examples: **primitives**, **projection_matrices**, **depth_texture**,
  **instanced_rendering**.
- **Done when:** 3D depth-tested scenes and instancing render correctly.

### Phase 4 — Textures & samplers
- `Texture` (2D/array/3D, mips, write/writeLayer), Sampler (custom enums), texture &
  sampler bind-group entries.
- Examples: **software_framebuffer**, a textured quad (new, mirrors cgfx texture docs).
- **Done when:** sampled textures and CPU→GPU pixel upload work.

### Phase 5 — Compute, MRT, advanced frame
- Compute pipeline + `ComputePass` (standalone and frame-embedded), multi-pass frame
  (`beginEncoder` + `beginRenderPassEx`), MRT, storage textures.
- Examples: **compute**, **compute_texture**, **mrt**.
- **Done when:** compute→render in one frame and MRT both work.

### Phase 6 — Loader, docs, polish
- `loader.js` (LearnWebGPU text mesh), error-scope polish, full `docs/` port,
  `README` finalisation, example menu polish.
- Examples: **loading_from_file**.
- **Done when:** docs mirror cgfx's structure; every example in §6 runs from the menu.

---

## 8. Open items / risks

- **Verification is visual** (browser-only, no Node). Each phase is checked by running
  its examples. A Playwright smoke-test harness is a possible later add-on, not planned.
- **`instanced_rendering`** at 250k cubes may need a lower default count for weaker web
  GPUs; expose the count as a constant.
- **`buffer.read` is async** everywhere it appears (unavoidable); example code adapts.
- **WebGPU availability** — examples show a friendly message if `navigator.gpu` is
  missing or the browser lacks WebGPU.
```

