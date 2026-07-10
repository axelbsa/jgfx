# Buffer

GPU buffer creation and management for vertex, index, uniform, storage, and generic data.

**File:** `buffer.js`

The `Buffer` class wraps a `GPUBuffer` together with its size and element count. Create
one with the generic constructor when you need full control over usage flags, or reach for
one of the typed factories (`vertex`/`index`/`uniform`/`storage`/`mapping`) for the common
cases — each just picks the right usage flags for you.

!!! note "Sizes are rounded up to 4 bytes"
    WebGPU requires buffer sizes and mapped/written ranges to be multiples of 4 bytes, so
    jgfx rounds the allocated size up to the next multiple of 4. The public `size` field
    reflects the aligned size, which may be larger than the byte length of the data you
    passed in. When the data isn't a multiple of 4, it is padded with zeros before upload.

---

## Fields

Every `Buffer` exposes:

| Field | Type | Description |
|-------|------|-------------|
| `buffer` | `GPUBuffer` | The underlying WebGPU buffer handle. |
| `size` | `number` | Allocated size in bytes (rounded up to a multiple of 4). |
| `count` | `number` | Number of elements (vertices, indices, or other). `0` if unset. |

---

## Constructor

### new Buffer / ctx.createBuffer

Generic buffer creation. You specify the usage flags directly. Uploads `data` immediately
if provided.

```js
import { Buffer } from "./jgfx/index.js";

const U = GPUBufferUsage;
const buf = new Buffer(ctx, U.STORAGE | U.COPY_DST | U.COPY_SRC, data);
// or, via the context:
const buf2 = ctx.createBuffer(U.STORAGE | U.COPY_DST | U.COPY_SRC, data);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `Context` | Initialized context (uses `device` and `queue`). |
| `usage` | `GPUBufferUsageFlags` | WebGPU usage flags, e.g. `GPUBufferUsage.STORAGE \| GPUBufferUsage.COPY_DST`. |
| `data` | `ArrayBuffer \| ArrayBufferView \| null` | Initial data to upload, or `null` to skip upload. |
| `opts` | `object` | Optional settings (see below). |

**Options:**

| Field | Type | Description |
|-------|------|-------------|
| `size` | `number` | Size in bytes. Defaults to `data.byteLength` (or `0` with no data). |
| `count` | `number` | Element count stored on the buffer. Defaults to `0`. |
| `label` | `string` | Debug label. Defaults to `"jgfx buffer"`. |

**Returns** a `Buffer`. `ctx.createBuffer(usage, data, opts)` is the exact equivalent.

---

## Factories

Each factory is available both as a static method on `Buffer` and as a matching
`Context` method. They differ only in call style — pick whichever reads better.

### Buffer.vertex / ctx.createVertexBuffer

Vertex buffer with usage `VERTEX | COPY_DST`. Uploads `data` and records the element
`count`.

```js
const vbuf = ctx.createVertexBuffer(vertices, 3);
// or: Buffer.vertex(ctx, vertices, 3)

frame.pass.setVertexBuffer(0, vbuf.buffer, 0, vbuf.size);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `Context` | Initialized context. (Static form only.) |
| `data` | `ArrayBuffer \| ArrayBufferView` | Vertex data to upload. |
| `count` | `number` | Number of vertices; stored as `count`. |

---

### Buffer.index / ctx.createIndexBuffer

Index buffer with usage `INDEX | COPY_DST`. Indices are 32-bit: if you pass anything other
than a `Uint32Array` it is converted with `Uint32Array.from`. `count` is set to the number
of indices.

```js
const ibuf = ctx.createIndexBuffer([0, 1, 2, 2, 3, 0]);
// or: Buffer.index(ctx, indices)

frame.pass.setIndexBuffer(ibuf.buffer, "uint32", 0, ibuf.size);
frame.pass.drawIndexed(ibuf.count);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `Context` | Initialized context. (Static form only.) |
| `indices` | `Uint32Array \| number[]` | Index data; coerced to `Uint32Array`. |

!!! note "Indices are always 32-bit"
    jgfx builds every index buffer as `Uint32Array` — bind it with format `"uint32"`. If
    you need 16-bit indices, use the generic constructor with `GPUBufferUsage.INDEX` and
    manage the format yourself. See [Mesh](mesh.md) for the standard indexed-draw path.

---

### Buffer.uniform / ctx.createUniformBuffer

Uniform buffer with usage `UNIFORM | COPY_DST`. Uploads the initial `data`.

```js
const ubuf = ctx.createUniformBuffer(uniformData);
// or: Buffer.uniform(ctx, uniformData)

// Update later:
ctx.queue.writeBuffer(ubuf.buffer, 0, uniformData);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `Context` | Initialized context. (Static form only.) |
| `data` | `ArrayBuffer \| ArrayBufferView` | Initial uniform data to upload. |

!!! tip "Prefer Uniform for the common case"
    If you have a single uniform buffer bound to one group, [`ctx.createUniform`](uniform.md)
    bundles the buffer, bind group, and a reference to your data into one object. Use
    `createUniformBuffer` when you need more control (e.g., multiple buffers in one bind
    group).

---

### Buffer.storage / ctx.createStorageBuffer

Storage buffer with usage `STORAGE | COPY_DST | COPY_SRC`. The `COPY_SRC` flag is included
so results can be copied into a mapping buffer for read-back.

```js
const src = new Float32Array(16);
const storage = ctx.createStorageBuffer(src);
// or: Buffer.storage(ctx, src)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `Context` | Initialized context. (Static form only.) |
| `data` | `ArrayBuffer \| ArrayBufferView` | Initial data to upload (pass a zero-filled array for an empty output buffer). |

See the [Compute](compute.md) reference for the GPGPU workflow.

---

### Buffer.mapping / ctx.createMappingBuffer

Read-back buffer with usage `MAP_READ | COPY_DST`. No initial data is uploaded — you copy
into it on the GPU, then map it with [`read()`](#read).

```js
const readback = ctx.createMappingBuffer(storage.size, count);
// or: Buffer.mapping(ctx, storage.size, count)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `Context` | Initialized context. (Static form only.) |
| `size` | `number` | Size of the buffer in bytes. |
| `count` | `number` | Optional element count; stored as `count`. Defaults to `0`. |

---

## Methods

### read

Maps the buffer, copies its contents out to the CPU, and unmaps. Requires `MAP_READ`
usage (i.e. a mapping buffer). Returns a **fresh `ArrayBuffer` copy** — the mapped range is
invalidated on unmap, so the data is sliced out before unmapping.

```js
const back = new Float32Array(await readback.read());
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `size` | `number` | Bytes to read. Defaults to the full buffer. Rounded up to a multiple of 4. |

**Returns:** `Promise<ArrayBuffer>`.

!!! warning "read() is async — you must await it"
    This is the key divergence from cgfx. cgfx's `cgfx_buffer_read` is **blocking** (it
    polls the device until the map completes). In the browser, buffer mapping is a Promise,
    so jgfx's `read()` is `async` and **must be awaited**. Wrap the surrounding code in an
    `async` function.

---

### copy

Copies this buffer into `dst` on the GPU and submits immediately. This buffer must have
`COPY_SRC` usage and `dst` must have `COPY_DST` usage. Creates a temporary command encoder,
records the copy, and submits it on the queue.

```js
storageBuf.copy(readbackBuf); // copies min(src, dst) bytes
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `dst` | `Buffer` | Destination buffer (must have `COPY_DST`). |
| `size` | `number` | Bytes to copy. Defaults to `min(src.size, dst.size)`. |

**Returns:** nothing.

---

### destroy

Releases the GPU buffer and clears the object's fields (`buffer` becomes `null`, `size` and
Don't use the buffer after this.

```js
buf.destroy();
```

!!! warning "Destroy before the context"
    Destroy all buffers before calling `ctx.destroy()`. The device is released during
    context destruction.

---

## Usage

### Buffer copy + async map-read

Round-trip data through the GPU: create a storage buffer with known values, copy it to a
mapping buffer, and read it back on the CPU.

```js
import { Context } from "./jgfx/index.js";

async function main() {
  const canvas = document.createElement("canvas");
  const ctx = await Context.create({ canvas, width: 1, height: 1 });

  // Source data: 16 floats [0, 1, 2, ... 15].
  const src = new Float32Array(16);
  for (let i = 0; i < src.length; i++) src[i] = i;

  const srcBuf = ctx.createStorageBuffer(src);          // STORAGE | COPY_DST | COPY_SRC
  const dstBuf = ctx.createMappingBuffer(src.byteLength); // MAP_READ | COPY_DST

  // GPU-side copy, then map-read back to the CPU.
  srcBuf.copy(dstBuf);
  const back = new Float32Array(await dstBuf.read());
  console.log(Array.from(back)); // [0, 1, 2, ... 15]

  srcBuf.destroy();
  dstBuf.destroy();
  ctx.destroy();
}
```

### Compute read-back

Storage buffers feed a compute shader; the output storage buffer is copied into a mapping
buffer and read back.

```js
const bufA = ctx.createStorageBuffer(a);
const bufB = ctx.createStorageBuffer(b);
const bufOut = ctx.createStorageBuffer(new Float32Array(N)); // zero-filled output

// ... dispatch a compute shader that writes bufOut ...

// Copy the results into a mappable buffer, then read them back to the CPU.
const readback = ctx.createMappingBuffer(bufOut.size, N);
bufOut.copy(readback);
const result = new Float32Array(await readback.read());

readback.destroy();
bufOut.destroy();
bufB.destroy();
bufA.destroy();
```

See the **playing_with_buffers** and **compute** examples for the full working pages, and
the [Shader](shader.md), [Mesh](mesh.md), and [Compute](compute.md) references for how
buffers plug into the rest of the API.
