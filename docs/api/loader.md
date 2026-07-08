# Loader

Load geometry from the LearnWebGPU bespoke text format.

**File:** `loader.js`

!!! warning "Temporary"
    This module loads geometry from the
    [LearnWebGPU](https://eliemichel.github.io/LearnWebGPU/) bespoke text format — the same
    helper cgfx ships to follow along with the book. It will be replaced by a real asset
    format (glTF) later. Do not build production pipelines on it.

These are standalone functions, not `Context` methods — mirroring cgfx's free
`cgfx_load_*` functions and keeping the temporary surface out of the core API. Because they
`fetch`, the two file-loading functions are `async`; the parser is pure and synchronous.

---

## File format

```text
# comments start with '#'
[points]
x y z r g b      # 6 floats per point, OR
x y r g b        # 5 floats per point (z defaults to 0)
[indices]
i0 i1 i2         # one triangle per line
```

- The `[points]` section has one point per line, with **5 or 6** space-separated floats.
  The width is auto-detected from the first data line.
- The `[indices]` section has one triangle per line, three integers each.
- Blank lines and lines starting with `#` are ignored.

---

## Functions

### parseGeometry

Parse the text format into raw geometry. Pure and synchronous — no I/O — so you can feed
it text from anywhere.

```js
import { parseGeometry } from "./jgfx/index.js";
const geo = parseGeometry(text);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | The full contents of a geometry text file. |

**Returns** a plain object:

| Field | Type | Description |
|-------|------|-------------|
| `pointData` | `Float32Array` | Flat, interleaved point data. |
| `pointCount` | `number` | Number of points (`pointData.length / floatsPerPoint`). |
| `floatsPerPoint` | `number` | 5 or 6, auto-detected from the first data line. |
| `indexData` | `Uint32Array` | Triangle indices. |
| `indexCount` | `number` | Number of indices. |

!!! note "Divergence from cgfx"
    cgfx's `CgfxGeometry.point_count` actually counts *floats*; jgfx's `pointCount` is the
    true number of points. jgfx also produces `Uint32Array` indices (cgfx uses
    `uint16_t`), matching `Mesh`'s 32-bit index buffers.

---

### loadGeometry

Fetch a geometry text file and parse it (= the I/O half of `cgfx_load_geometry`).

```js
const geo = await loadGeometry("./webgpu.txt");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | URL of the geometry text file. |

**Returns:** `Promise<object>` — the same shape as [`parseGeometry`](#parsegeometry).
**Throws** if the fetch fails (e.g. 404).

---

### loadMesh

Load a file and build a [`Mesh`](mesh.md) in one call (= `cgfx_load_tutorial_mesh`).

```js
const mesh = await loadMesh(ctx, "./webgpu.txt");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `Context` | An initialized context. |
| `url` | `string` | URL of the geometry text file. |

**Returns:** `Promise<Mesh>`. Destroy it with `mesh.destroy()`.

Each point becomes a standard vertex with a white-alpha color:

- **6 floats** (`x y z r g b`): position `(x, y, z)`, color `(r, g, b, 1)`.
- **5 floats** (`x y r g b`): position `(x, y, 0)`, color `(r, g, b, 1)`.

---

## Usage

### Quick mesh loading

```js
import { Context, Mesh, loadMesh } from "./jgfx/index.js";

const ctx = await Context.create({ canvas });
const shader = await ctx.createShaderFromFile("load", "./shader.wgsl");
const pipeline = ctx.createPipeline({ shader, vertexLayouts: [Mesh.vertexLayout()] });

const mesh = await loadMesh(ctx, "./webgpu.txt");

function render() {
  const frame = ctx.beginFrame([0.1, 0.1, 0.2, 1]);
  if (frame) {
    frame.pass.setPipeline(pipeline);
    mesh.draw(frame.pass);
    ctx.endFrame(frame);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
```

### Manual loading (for inspection or custom conversion)

```js
const geo = await loadGeometry("./model.txt");
console.log(`${geo.pointCount} points (${geo.floatsPerPoint} floats each)`);
console.log(`${geo.indexCount} indices`);
// convert manually, or use the raw typed arrays directly...
```

!!! tip "Pipeline vertex layout"
    Meshes from `loadMesh` use the standard vertex format, so create the pipeline with
    `Mesh.vertexLayout()` just like any other mesh. See the [Mesh](mesh.md) reference.

See the **loading_from_file** example for the full working page.
