# Texture

GPU texture and sampler abstraction.

**File:** `texture.js`

A `Texture` wraps a `GPUTexture` and its default `GPUTextureView` in one object, so
`texture.view` drops straight into a bind group and `texture.texture` is there for raw
WebGPU calls. Loading pixels from disk is not jgfx's concern — the caller produces pixels
however it likes (canvas, `fetch` + `ImageBitmap`, a CPU typed array) and uploads them with
[`write()`](#write) / [`writeLayer()`](#writelayer).

Samplers are separate, reusable objects. [`createSampler`](#createsampler) returns a **raw
`GPUSampler`** — a sampler needs no wrapper, and [`Shader.createBindGroup`](shader.md) takes
it directly.

---

## Texture

A GPU texture with its default view. Create it with `ctx.createTexture(desc)` or
`new Texture(ctx, desc)` — the context method is just a thin wrapper.

### Public fields

All fields are public. Check `ok` before use.

| Field | Type | Description |
|-------|------|-------------|
| `texture` | `GPUTexture` | GPU texture handle, for raw WebGPU calls. |
| `view` | `GPUTextureView` | Default view (whole texture, all mips, all layers). Drop into a bind group. |
| `format` | `GPUTextureFormat` | Pixel format. |
| `width` | `number` | Width in pixels. |
| `height` | `number` | Height in pixels. |
| `depth` | `number` | Depth or array layers (1 for a plain 2D texture). |
| `mipLevels` | `number` | Number of mip levels. |
| `ok` | `boolean` | `true` if creation succeeded. |

---

### ctx.createTexture

Create a GPU texture and its default view. No pixels are uploaded.

```js
const tex = ctx.createTexture({ width: 256, height: 256 });
// or, equivalently:
import { Texture } from "./jgfx/index.js";
const tex = new Texture(ctx, { width: 256, height: 256 });
```

A zero-config desc (just `width`, optional `height`) gives a sampled 2D `rgba8unorm`
texture. `desc.width` is **required** — omitting it throws.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `width` | `number` | *(required)* | Texture width. |
| `height` | `number` | `1` | Texture height. |
| `depth` | `number` | `1` | Depth or array layers. Set to `6` for a cube map. |
| `format` | `GPUTextureFormat` | `"rgba8unorm"` | Pixel format. |
| `dimension` | `GPUTextureDimension` | `"2d"` | Texture dimension (`"1d"` / `"2d"` / `"3d"`). |
| `mipLevels` | `number` | `1` | Mip level count. |
| `sampleCount` | `number` | `1` | MSAA sample count. |
| `usage` | `GPUTextureUsageFlags` | `TEXTURE_BINDING \| COPY_DST` | Usage flags. Depth formats default to `RENDER_ATTACHMENT`. |
| `viewDimension` | `GPUTextureViewDimension` | auto-detect | Default view's dimension. Auto: `"2d"` for a single layer, `"2d-array"` for `depth > 1`, `"3d"`/`"1d"` from `dimension`. Set to `"cube"` for cube maps. |
| `label` | `string` | `"jgfx texture"` | Debug label. |

**Returns:** a `Texture`. Release it with [`destroy()`](#destroy).

For depth formats (`depth24plus`, `depth32float`, `depth32float-stencil8`, …) the default
usage becomes `RENDER_ATTACHMENT`, and depth-only formats get their view `aspect` set to
`"depth-only"` automatically.

!!! note "View dimension auto-detection"
    When `viewDimension` is omitted, the default view's dimension is inferred from
    `dimension` and `depth`:

    | Dimension | Depth | View dimension |
    |-----------|-------|----------------|
    | `1d` | any | `1d` |
    | `2d` | 1 | `2d` |
    | `2d` | > 1 | `2d-array` |
    | `3d` | any | `3d` |

    Set `viewDimension: "cube"` explicitly for cube maps (`depth: 6`), or `"cube-array"`
    for cube map arrays — the count alone can't distinguish those from a plain array.

---

### write

Upload pixel data to mip 0, from origin `(0, 0, 0)`, across **all** layers. `bytesPerRow`
and `rowsPerImage` are derived from the texture's format and dimensions.

```js
tex.write(pixels); // pixels: an ArrayBufferView or ArrayBuffer
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `ArrayBufferView \| ArrayBuffer` | Tightly packed pixel data for the whole texture. |

The texture must have `COPY_DST` usage (the default does). Row stride is computed as
`width × bytesPerPixel` for common uncompressed formats.

!!! warning "Unsupported formats throw"
    `write()` / `writeLayer()` only know the bytes-per-pixel of common uncompressed formats
    (r8/rg8/rgba8, the 16- and 32-bit int/float families, `bgra8unorm`, `rgb10a2unorm`, …).
    For compressed or exotic formats, sub-regions, or non-zero mip levels, call
    `ctx.queue.writeTexture(...)` directly on `tex.texture` with an explicit layout.

---

### writeLayer

Upload pixel data to a single array layer or cube face.

```js
for (let face = 0; face < 6; face++) {
  cubemap.writeLayer(face, faceData[face]);
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `layer` | `number` | Array layer or cube face index. |
| `data` | `ArrayBufferView \| ArrayBuffer` | Pixel data for one layer. |

For cube maps, layers 0–5 correspond to +X, −X, +Y, −Y, +Z, −Z.

---

### destroy

Release the texture and its view.

```js
tex.destroy();
```

Sets `view` and `texture` to `null` and `ok` to `false`. The `GPUTexture` itself is
destroyed; the view is dropped for the garbage collector.

---

## createSampler

Create a sampler. Returns a **raw `GPUSampler`** owned by the caller — there is no wrapper
and **no `destroy()`**; the GPU sampler is reclaimed by the garbage collector when it is no
longer referenced. Call it as `createSampler(ctx, desc)` or `ctx.createSampler(desc)`.

```js
import { createSampler, Filter, Address } from "./jgfx/index.js";

const sampler = createSampler(ctx); // linear + clamp-to-edge
```

Filter and address fields use the `Filter` and `Address` enums, whose `DEFAULT` member
resolves to the **sensible** default (Linear / ClampToEdge) rather than the WebGPU default —
so an omitted field gives linear filtering, and you can still explicitly select `NEAREST`
or `REPEAT`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `magFilter` | `Filter` | `Linear` | Magnification filter. `Filter.NEAREST` for crisp pixels. |
| `minFilter` | `Filter` | `Linear` | Minification filter. |
| `mipmapFilter` | `Filter` | `Linear` | Mipmap filter. |
| `addressU` | `Address` | `ClampToEdge` | U-axis address mode. `Address.REPEAT` / `MIRROR` for tiling. |
| `addressV` | `Address` | `ClampToEdge` | V-axis address mode. |
| `addressW` | `Address` | `ClampToEdge` | W-axis address mode. |
| `maxAnisotropy` | `number` | `1` | Maximum anisotropy. |
| `compare` | `GPUCompareFunction` | *(none)* | Comparison function. Omit for a normal sampler; set it for depth/shadow samplers. |
| `label` | `string` | `"jgfx sampler"` | Debug label. |

**Returns:** a `GPUSampler`. `lodMinClamp`/`lodMaxClamp` are fixed at `0`/`32`.

The `Filter` enum is `Filter.DEFAULT` / `Filter.NEAREST` / `Filter.LINEAR`; the `Address`
enum is `Address.DEFAULT` / `Address.CLAMP` / `Address.REPEAT` / `Address.MIRROR`.

```js
// Nearest (point) sampler for pixel-art / software-framebuffer upscaling:
const nearest = createSampler(ctx, {
  magFilter: Filter.NEAREST,
  minFilter: Filter.NEAREST,
  mipmapFilter: Filter.NEAREST,
});
```

---

## Usage flags

The `usage` flags select what the texture can be used for. The common cases:

| Use | Flags |
|-----|-------|
| **Sampled** (read in a shader via a sampler) | `TEXTURE_BINDING \| COPY_DST` (the default) |
| **Storage** (written directly by a compute shader) | `STORAGE_BINDING` (add `TEXTURE_BINDING` if a later pass samples it) |
| **Render target** | `RENDER_ATTACHMENT` (the default for depth formats) |

A storage texture that a compute pass writes and a render pass then samples needs **both**
`STORAGE_BINDING | TEXTURE_BINDING` — see [Compute](compute.md).

---

## Examples

### Texture + sampler bind group

To sample a texture in a shader, declare a texture and a sampler binding, then build a
bind group with both. The `Texture` goes in as the whole object (jgfx pulls `.view`); the
sampler goes in raw.

```wgsl
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
```

```js
import { Context, Mesh, Binding, createSampler } from "./jgfx/index.js";

const shader = ctx.createShader("textured", wgsl, {
  groups: [
    { bindings: [{ binding: 0, minBindingSize: 64 }] }, // mvp uniform
    {
      bindings: [
        { binding: 0, kind: Binding.TEXTURE },
        { binding: 1, kind: Binding.SAMPLER },
      ],
    },
  ],
});

// Upload the texture once; make a linear, clamped sampler.
const texture = ctx.createTexture({ width: 256, height: 256 });
texture.write(pixels);                 // Uint8Array, 256*256*4 bytes
const sampler = createSampler(ctx);    // defaults: linear + clamp-to-edge

const texBG = shader.createBindGroup(1, [
  { binding: 0, texture },             // pass the Texture; jgfx uses its .view
  { binding: 1, sampler },             // raw GPUSampler
]);

// per frame:
frame.pass.setBindGroup(1, texBG);
```

### CPU pixels → texture (software framebuffer)

Keep a small CPU pixel buffer, plot into it, and re-upload each frame. A `NEAREST` sampler
upscales the tiny framebuffer to the window with crisp, blocky pixels.

```js
const FB_W = 320, FB_H = 200;

const pixels = new Uint32Array(FB_W * FB_H);        // pack RGBA as u32
const pixelBytes = new Uint8Array(pixels.buffer);   // view for upload

const fb = ctx.createTexture({
  width: FB_W,
  height: FB_H,
  format: "rgba8unorm",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
const sampler = createSampler(ctx, {
  magFilter: Filter.NEAREST,
  minFilter: Filter.NEAREST,
  mipmapFilter: Filter.NEAREST,
});

function render() {
  plot(pixels);          // CPU rasterize (RGBA on little-endian: r | g<<8 | b<<16 | a<<24)
  fb.write(pixelBytes);  // upload → queue.writeTexture with auto bytesPerRow
  // ... draw a fullscreen triangle that samples fb ...
}
```

!!! note "WGSL uniformity divergence"
    In the browser, `textureSample` must be called from **uniform control flow** — you
    cannot call it inside an `if`/`else` branch that varies per invocation, or the shader
    fails to compile. (Native cgfx is more permissive here.) Sample into a variable at the
    top level of your fragment function, then branch on the result; or use
    `textureSampleLevel` / `textureLoad`, which have no uniformity requirement.

See the **textured_quad** and **software_framebuffer** examples for full working pages.

---

## See also

- [Shader](shader.md) — declaring texture/sampler bindings and building bind groups.
- [Buffer](buffer.md) — uniform and storage buffers.
- [Compute](compute.md) — writing storage textures from a compute shader.
