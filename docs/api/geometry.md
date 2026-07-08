# Geometry

Procedural primitive generators — cube, plane, and sphere.

**File:** `geometry.js`

The `geometry` namespace builds mesh data in plain JavaScript. Every generator returns a
`{ vertices, indices }` object ready to hand to [`Mesh`](mesh.md) — no context, no GPU, no
allocation on the device until you upload it. `vertices` is an array of vertex objects
(`{ position, normal, texcoord0 }`); `indices` is an array of numbers.

```js
import { geometry } from "./jgfx/index.js";

const { vertices, indices } = geometry.cube({ size: 1.5 });
const mesh = ctx.createMesh(vertices, indices);
```

Because the output is plain data, you can post-process it — displace positions, tint
vertices, merge shapes — before it ever reaches the GPU. See the
[Procedural Geometry guide](../guides/procedural-geometry.md) for a worked walkthrough.

!!! note "Winding: clockwise in model space"
    All three generators emit triangles wound **clockwise when viewed from outside**, in
    model space. Combined with WebGPU's Y-down framebuffer this presents exteriors as
    front faces, so a `frontFace: "ccw"` + `cullMode: "back"` pipeline shows the outside and
    culls the inside — no per-mesh override needed. See the guide's
    [winding note](../guides/procedural-geometry.md#winding-why-the-triangles-look-backwards).

!!! note "Which vertex fields are filled"
    Generators set `position`, `normal`, and `texcoord0`. Everything else (`color`,
    `tangent`, `texcoord1`, `joints`, `weights`) is left to [`Mesh`](mesh.md)'s per-field
    defaults — notably `color` defaults to opaque white, so an untinted primitive is still
    visible.

---

## cube

An axis-aligned cube centered at the origin.

```js
const { vertices, indices } = geometry.cube({ size: 1.5 });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `size` | `number` | `1` | Edge length. The cube spans `[-size/2, +size/2]` on each axis. |

**Returns:** `{ vertices, indices }` — **24 vertices, 36 indices** (12 triangles).

Each of the 6 faces gets its own 4 corners so it can carry one hard, axis-aligned face
normal (exactly `±X` / `±Y` / `±Z`). Sharing the 8 geometric corners would average the
normals and smooth the edges — wrong for a cube.

---

## plane

A flat quad on the XZ ground plane, centered at the origin, facing up (`normal = [0, 1, 0]`).

```js
const { vertices, indices } = geometry.plane({ size: 2, segments: 4 });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `size` | `number` | `1` | Side length. The plane spans `[-size/2, +size/2]` on X and Z. |
| `segments` | `number` | `1` | Grid subdivisions per side. Higher values give more vertices for heightmap displacement or per-vertex effects. |

**Returns:** `{ vertices, indices }` — `(segments + 1)²` vertices and `2 × segments²`
triangles. UVs run `[0, 1]` across the grid.

---

## sphere

A UV sphere centered at the origin, using latitude/longitude parameterization.

```js
const { vertices, indices } = geometry.sphere({ radius: 0.8, segments: 24, rings: 16 });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `radius` | `number` | `0.5` | Sphere radius. |
| `segments` | `number` | `32` | Subdivisions around the equator (longitude, `0…2π`). |
| `rings` | `number` | `16` | Subdivisions from pole to pole (latitude, `0…π`). |

**Returns:** `{ vertices, indices }` — `(segments + 1) × (rings + 1)` vertices. Each vertex's
normal is its normalized position (a sphere is its own normal field). The last column
duplicates the first so a texture doesn't seam where the UV wraps.

---

## Usage

```js
import { Context, Mesh, geometry } from "./jgfx/index.js";

const ctx = await Context.create({ canvas, depthBuffer: true });
const pipeline = ctx.createPipeline({
  shader,
  depthTest: true,
  cullMode: "back", // safe: generators wind CW-from-outside (see note above)
  vertexLayouts: [Mesh.vertexLayout()],
});

const { vertices, indices } = geometry.sphere({ radius: 0.8 });
const mesh = ctx.createMesh(vertices, indices);

// in the frame loop:
mesh.draw(frame.pass);
```

### Post-processing the data

Because a vertex is a plain object, you can edit it before building the mesh:

```js
const geo = geometry.sphere({ radius: 0.8 });
for (const v of geo.vertices) {
  // tint by normal direction
  v.color = [v.normal[0] * 0.5 + 0.5, v.normal[1] * 0.5 + 0.5, 1, 1];
}
const mesh = ctx.createMesh(geo.vertices, geo.indices);
```

---

## See also

- [Procedural Geometry guide](../guides/procedural-geometry.md) — the full walkthrough,
  including rendering with a [Camera](camera.md).
- [Mesh](mesh.md) — the standard vertex format these feed, and `Mesh.vertexLayout()`.
- [Math](math.md) — `mat4` / `vec3` for placing and animating the meshes.
