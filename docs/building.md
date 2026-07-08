# Running & Bundling

jgfx has no build step. The library **is** the source — you import `jgfx/index.js`
directly and hack on it with nothing installed. This page covers the two things you might
still want to do: serve the examples, and (optionally) produce a single-file bundle for
vendoring.

## Serving

WebGPU requires a secure context, and the examples use `fetch`, so you must serve over
`http://localhost` — a `file://` URL will not work. Any static file server does:

```bash
# from the repository root
python3 -m http.server 8099      # or: npx serve, or any static server
```

Then open <http://localhost:8099/examples/> for the example menu, or a specific example
like <http://localhost:8099/examples/triangle/>.

!!! tip "Serve from the repo root"
    Examples import the library with a relative path (`../../jgfx/index.js`) and `fetch`
    sibling assets (`./webgpu.txt`). Serving from the repository root keeps those paths
    valid.

## Using the library in your own page

Point an `import` at `jgfx/index.js` — copy the `jgfx/` folder into your project, or
reference it wherever you serve it from:

```html
<script type="module">
  import { Context, Mesh, math } from "./jgfx/index.js";
  const ctx = await Context.create({ canvas: document.querySelector("canvas") });
  // ...
</script>
```

That's the whole story for the ESM source. The rest of this page is optional.

## Single-file bundle (optional)

For vendoring jgfx as one file, a zero-dependency amalgamator stitches the modules
together — in the spirit of SQLite's `sqlite3.c`. It is plain Node with **nothing
installed**:

```bash
node build.mjs      # or: npm run build
```

It reads `jgfx/*.js`, resolves the import graph from `jgfx/index.js`, and writes three
files to `dist/` (all committed, all generated — do not hand-edit):

| File | Use |
|------|-----|
| `dist/jgfx.js` | Readable ESM bundle — `import { Context } from "./dist/jgfx.js"` |
| `dist/jgfx.min.js` | Same, lightly minified (comments and blank lines stripped) |
| `dist/jgfx.global.js` | IIFE exposing `window.Jgfx` for a plain `<script src>` (no modules) |

```html
<!-- ESM bundle -->
<script type="module">
  import { Context } from "./dist/jgfx.js";
</script>

<!-- or a classic global -->
<script src="./dist/jgfx.global.js"></script>
<script>
  const ctx = await Jgfx.Context.create({ canvas });
</script>
```

!!! note "It's a real bundler, not `cat`"
    The amalgamator wraps each module in its own function scope behind a tiny `__require`
    registry and rewrites only the `import`/`export` statements — module bodies are left
    untouched, so identifiers never collide. That is what lets it preserve the
    `export * as math` / `export * as geometry` namespaces correctly.

Verify a fresh build by opening `dist/smoke.html` in the browser — it loads both bundles
and draws a triangle. Rebuild after **any** change to `jgfx/*.js`.

## Building the documentation (optional)

These docs are plain Markdown — they render fine on GitHub as-is. To build the searchable
themed site (the same [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/)
theme cgfx uses), you need Python:

```bash
pip install -r requirements-docs.txt
mkdocs serve      # live preview at http://127.0.0.1:8000
mkdocs build      # static site into site/
```

Documentation tooling is entirely optional — it is never needed to use the library.
