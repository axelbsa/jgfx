/**
 * @file build.mjs
 * @brief Zero-dependency amalgamator — bundles jgfx/*.js into single files.
 *
 * jgfx's source is plain ESM with no build step: you can import jgfx/index.js
 * directly and hack on it with nothing installed. This script is an OPTIONAL
 * convenience that stitches the modules into one file for people who want to
 * vendor jgfx as a single drop-in — the spirit of SQLite's amalgamated
 * `sqlite3.c`, in JavaScript.
 *
 *   node build.mjs
 *
 * It is NOT a naive concatenation: index.js re-exports whole modules as
 * namespaces (`export * as math`), so modules must keep their own scope. We give
 * each module a tiny function scope and a minimal `__require` registry — only
 * import/export *statements* are rewritten, never the code inside them, so there
 * is no risk of identifier collisions or mangled bodies.
 *
 * Outputs (all committed under dist/):
 *   dist/jgfx.js         readable ESM bundle — `import { Context } from ".../jgfx.js"`
 *   dist/jgfx.min.js     ESM bundle, lightly minified (comments/blank lines stripped)
 *   dist/jgfx.global.js  IIFE exposing window.Jgfx for a plain <script src>
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(ROOT, "jgfx");
const OUT_DIR = join(ROOT, "dist");
const ENTRY = "index.js";

/** Split a `{ A, B as C }` clause into [{ imported, local }]. */
function parseSpecifiers(brace) {
  return brace
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [imported, local] = s.split(/\s+as\s+/);
      return { imported: imported.trim(), local: (local ?? imported).trim() };
    });
}

/**
 * Transform one module's source into the body of its registry IIFE. Returns the
 * rewritten code, the list of module ids it depends on, and the names it
 * exports (used to generate the entry's public exports).
 */
function transformModule(id, src) {
  const deps = new Set();
  const trailing = []; // exports.* assignments appended after the body
  const localExports = []; // names declared locally with `export`

  let code = src;

  // export { A, B as C } from "./y.js";   /  export * as ns from "./y.js";
  code = code.replace(
    /^[ \t]*export\s+(?:\*\s+as\s+([A-Za-z0-9_$]+)|(\{[\s\S]*?\}))\s+from\s+["']([^"']+)["'];?[ \t]*$/gm,
    (_m, ns, brace, dep) => {
      const depId = dep.replace(/^\.\//, "");
      deps.add(depId);
      if (ns) {
        trailing.push(`exports.${ns} = __require(${JSON.stringify(depId)});`);
      } else {
        for (const { imported, local } of parseSpecifiers(brace)) {
          trailing.push(
            `exports.${local} = __require(${JSON.stringify(depId)}).${imported};`,
          );
        }
      }
      return "";
    },
  );

  // export * from "./y.js";
  code = code.replace(
    /^[ \t]*export\s+\*\s+from\s+["']([^"']+)["'];?[ \t]*$/gm,
    (_m, dep) => {
      const depId = dep.replace(/^\.\//, "");
      deps.add(depId);
      trailing.push(`Object.assign(exports, __require(${JSON.stringify(depId)}));`);
      return "";
    },
  );

  // import { A, B as C } from "./y.js";  /  import * as ns from "./y.js";
  code = code.replace(
    /^[ \t]*import\s+(?:\*\s+as\s+([A-Za-z0-9_$]+)|(\{[\s\S]*?\})|([A-Za-z0-9_$]+))\s+from\s+["']([^"']+)["'];?[ \t]*$/gm,
    (_m, ns, brace, dflt, dep) => {
      const depId = dep.replace(/^\.\//, "");
      deps.add(depId);
      const req = `__require(${JSON.stringify(depId)})`;
      if (ns) return `const ${ns} = ${req};`;
      if (brace) {
        const inner = parseSpecifiers(brace)
          .map(({ imported, local }) =>
            imported === local ? imported : `${imported}: ${local}`,
          )
          .join(", ");
        return `const { ${inner} } = ${req};`;
      }
      return `const ${dflt} = ${req}.default;`;
    },
  );

  // export const/let/var/function/class NAME  →  strip `export `, record NAME.
  code = code.replace(
    /^([ \t]*)export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z0-9_$]+)/gm,
    (_m, ws, kw, name) => {
      localExports.push(name);
      return `${ws}${kw} ${name}`;
    },
  );

  // Bare local re-export list: export { a, b as c };  (no `from`, run last)
  code = code.replace(
    /^[ \t]*export\s+(\{[\s\S]*?\});?[ \t]*$/gm,
    (_m, brace) => {
      for (const { imported, local } of parseSpecifiers(brace)) {
        // `imported` is the local binding; `local` is the exported name.
        trailing.push(`exports.${local} = ${imported};`);
      }
      return "";
    },
  );

  if (localExports.length) {
    trailing.push(`Object.assign(exports, { ${localExports.join(", ")} });`);
  }

  const exportNames = [
    ...localExports,
    // recover names assigned via `exports.NAME =` in trailing statements
    ...trailing
      .map((s) => /^exports\.([A-Za-z0-9_$]+)\s*=/.exec(s)?.[1])
      .filter(Boolean),
  ];

  const body = `${code.trimEnd()}\n${trailing.join("\n")}`;
  return { code: body, deps: [...deps], exportNames: [...new Set(exportNames)] };
}

/** Depth-first post-order topological sort of the module graph from ENTRY. */
function resolveOrder(modules) {
  const order = [];
  const seen = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    if (visiting.has(id)) throw new Error(`[build] import cycle at ${id}`);
    visiting.add(id);
    for (const dep of modules.get(id).deps) visit(dep);
    visiting.delete(id);
    seen.add(id);
    order.push(id);
  };
  visit(ENTRY);
  return order;
}

/** Load + transform every module reachable from ENTRY. */
function loadModules() {
  const modules = new Map();
  const load = (id) => {
    if (modules.has(id)) return;
    const src = readFileSync(join(SRC_DIR, id), "utf8");
    const mod = transformModule(id, src);
    modules.set(id, mod);
    for (const dep of mod.deps) load(dep);
  };
  load(ENTRY);
  return modules;
}

/** The shared registry + all module IIFEs, in dependency order. */
function assembleBody(modules, order) {
  const parts = [
    "const __modules = {};",
    "function __require(id) { return __modules[id]; }",
    "",
  ];
  for (const id of order) {
    parts.push(
      `__modules[${JSON.stringify(id)}] = (function () {`,
      "const exports = {};",
      modules.get(id).code,
      "return exports;",
      "})();",
      "",
    );
  }
  return parts.join("\n");
}

const BANNER = (fmt) =>
  `/**\n` +
  ` * jgfx — amalgamated ${fmt} build. GENERATED by build.mjs — DO NOT EDIT.\n` +
  ` * Source of truth: jgfx/*.js. Regenerate with:  node build.mjs\n` +
  ` */\n`;

/** Light, safe minify: drop block comments, comment-only lines, blank lines. */
function minify(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, "") // block + JSDoc comments
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("//"))
    .join("\n");
}

function build() {
  const modules = loadModules();
  const order = resolveOrder(modules);
  const body = assembleBody(modules, order);
  const entry = modules.get(ENTRY);

  // ESM bundle: re-export the entry module's names as static ESM exports.
  const esmExports = entry.exportNames
    .map((n) => `export const ${n} = __entry.${n};`)
    .join("\n");
  const esm =
    BANNER("ESM") +
    body +
    `\nconst __entry = __modules[${JSON.stringify(ENTRY)}];\n` +
    esmExports +
    "\n";

  // IIFE global: expose the entry namespace as window.Jgfx.
  const iife =
    BANNER("IIFE global") +
    "(function () {\n" +
    body +
    `\nconst __entry = __modules[${JSON.stringify(ENTRY)}];\n` +
    "const __g = typeof globalThis !== \"undefined\" ? globalThis : self;\n" +
    "__g.Jgfx = __entry;\n" +
    "})();\n";

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "jgfx.js"), esm);
  writeFileSync(join(OUT_DIR, "jgfx.min.js"), BANNER("minified ESM") + minify(esm) + "\n");
  writeFileSync(join(OUT_DIR, "jgfx.global.js"), iife);

  const names = entry.exportNames.length;
  console.log(
    `[build] ${order.length} modules → dist/ (jgfx.js, jgfx.min.js, jgfx.global.js), ` +
      `${names} public exports`,
  );
  console.log(`[build] order: ${order.join(" → ")}`);
}

build();
