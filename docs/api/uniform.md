# Uniform

Uniform buffer + bind group bundle for per-object uniform data.

**File:** `uniform.js`

`Uniform` bundles a GPU uniform buffer, its bind group, and a reference to your own
`TypedArray` into a single object. You keep ownership of the data: **mutate it in place,
then call `write()`** to upload the new contents. This is the JS analogue of cgfx's data
pointer — jgfx holds a reference to your array rather than copying it.

---

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `data` | `ArrayBufferView` | Reference to your uniform data (never copied, never freed by jgfx). |
| `size` | `number` | Size of the uniform data in bytes (`data.byteLength`). |
| `buffer` | [`Buffer`](buffer.md) | The GPU uniform buffer (`UNIFORM \| COPY_DST`). |
| `bindGroup` | `GPUBindGroup` | Bind group referencing this buffer, for the given `@group`. |
| `ok` | `boolean` | `true` if both the buffer and bind group were created — check before use. |

---

## Constructor

### ctx.createUniform

Create a uniform buffer and bind group in one call. Allocates a [`Buffer`](buffer.md) with
usage `UNIFORM | COPY_DST`, uploads the initial contents of `data`, and builds a bind group
at the given `@group` index using the shader's layout. A **reference** to `data` is kept for
later `write()` calls.

```js
const data = new Float32Array([1.0, 0.3, 0.3, 1.0, -0.4, 0, 0, 0]);
const uniform = ctx.createUniform(shader, 0, data);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `shader` | [`Shader`](shader.md) | Shader providing the bind group layout. |
| `groupIndex` | `number` | The `@group(N)` index to build the bind group for. |
| `data` | `ArrayBufferView` | Your uniform data (a `TypedArray`), kept by reference. |

**Returns:** a `Uniform`. Call [`destroy()`](#destroy) to release it.

!!! warning "Keep your data array alive"
    `Uniform` stores a reference to your `TypedArray`, not a copy. Keep it alive for the
    lifetime of the `Uniform`. If you replace the variable with a new array, `write()` will
    still upload the *original* array — mutate the same array in place instead.

---

## Methods

### write

Uploads the current contents of `data` to the GPU via `queue.writeBuffer`. Call it each
frame after modifying your array.

```js
data[6] = t;      // mutate your array in place
uniform.write();  // then upload
```

**Returns:** nothing.

---

### destroy

Releases the underlying buffer **and** the bind group, and clears the object's fields
(`bindGroup` and `data` become `null`, `ok` becomes `false`). Unlike your data array — which
jgfx never owns — the bind group is created by `Uniform`, so it is released here.

```js
uniform.destroy();
```

!!! note "Destroy before the context"
    Destroy uniforms before calling `ctx.destroy()`. This releases both GPU resources it
    owns; your `data` array is left untouched.

---

## Usage

### The mutate-then-write pattern

The uniform workflow is three steps:

1. **`ctx.createUniform`** — allocate the GPU buffer and bind group.
2. **mutate `data` then `write()`** — update and upload each frame.
3. **`destroy()`** — release GPU resources.

### Multiple uniforms — two objects, one shader

Because a [`Shader`](shader.md) owns layouts but not bind groups, you can create multiple
uniforms from the same shader for per-object variation. Each keeps its own data array; mutate
it in place and `write()` before drawing.

```js
import { Context } from "./jgfx/index.js";

async function main() {
  const canvas = document.getElementById("gfx");
  const ctx = await Context.create({ canvas, width: 800, height: 600 });

  const shader = ctx.createShader("uniforms", wgsl, {
    groups: [{ bindings: [{ binding: 0, minBindingSize: 32 }] }],
  });
  const pipeline = ctx.createPipeline({ shader });

  // Two objects, same layout, different data. [r,g,b,a, ox,oy,rot,_].
  const left = new Float32Array([1.0, 0.3, 0.3, 1.0, -0.4, 0, 0, 0]);
  const right = new Float32Array([0.3, 0.5, 1.0, 1.0, 0.4, 0, 0, 0]);
  const uLeft = ctx.createUniform(shader, 0, left);
  const uRight = ctx.createUniform(shader, 0, right);

  let t = 0;
  function render() {
    t += 0.016;
    left[6] = t;        // mutate the plain array in place...
    right[6] = -t * 0.7;
    uLeft.write();      // ...then upload it.
    uRight.write();

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
}
```

!!! tip "Lower-level API"
    For advanced cases, the lower-level [`ctx.createUniformBuffer`](buffer.md) and the
    shader's `createBindGroupBuffers` remain available. `Uniform` is a convenience wrapper
    built on top of those.

See the **multiple_uniforms** example for the full working page, and the [Shader](shader.md)
and [Buffer](buffer.md) references for the pieces `Uniform` bundles together.
