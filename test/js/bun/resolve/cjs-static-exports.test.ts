import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// `import { x } from "./file.cjs"` links the names Node's cjs-module-lexer would
// find in the source (exports.x = ..., module.exports = { x }, re-exports, ...)
// in addition to the own properties of the evaluated `module.exports`. A name
// that evaluation never produced imports as `undefined` instead of throwing
// "Export named 'x' not found" at link time, matching Node.
//
// Every fixture gates some assignments on an environment variable that is never
// set, so the evaluated module.exports lacks those names.
const NEVER = "process.env.CJS_STATIC_EXPORTS_TEST_NEVER_SET";

async function runEntry(cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function runJSON(files: Record<string, string>) {
  using dir = tempDir("cjs-static-exports", files);
  const { stdout, stderr, exitCode } = await runEntry(String(dir));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

test.concurrent("exports.x assigned conditionally or in dead code still links", async () => {
  const result = await runJSON({
    "cond.cjs": `
      exports.always = 1;
      if (${NEVER}) exports.debugOnly = function debugOnly() {};
      if (typeof window !== "undefined") exports.browserOnly = 1;
      function neverCalled() { exports.neverAssigned = 1; }
    `,
    "entry.mjs": `
      import { always, debugOnly, browserOnly, neverAssigned } from "./cond.cjs";
      import * as ns from "./cond.cjs";
      console.log(JSON.stringify({
        always,
        debugOnly: typeof debugOnly,
        browserOnly: typeof browserOnly,
        neverAssigned: typeof neverAssigned,
        keys: Object.keys(ns),
        hasDebugOnly: "debugOnly" in ns,
        defaultKeys: Object.keys(ns.default),
      }));
    `,
  });
  expect(result).toEqual({
    always: 1,
    debugOnly: "undefined",
    browserOnly: "undefined",
    neverAssigned: "undefined",
    keys: ["always", "browserOnly", "debugOnly", "default", "neverAssigned"],
    hasDebugOnly: true,
    // require() and the default import see the real object, untouched.
    defaultKeys: ["always"],
  });
});

test.concurrent("a name removed by a later module.exports = {...} still links", async () => {
  const result = await runJSON({
    "shapes.cjs": `exports.a = 1; module.exports = { b: 2 };`,
    "entry.mjs": `
      import { a, b } from "./shapes.cjs";
      import * as ns from "./shapes.cjs";
      console.log(JSON.stringify({ a: typeof a, b, keys: Object.keys(ns) }));
    `,
  });
  expect(result).toEqual({ a: "undefined", b: 2, keys: ["a", "b", "default"] });
});

test.concurrent("evaluated values win; names only known at runtime are kept", async () => {
  const result = await runJSON({
    // TypeScript output declares every export before assigning it.
    "mod.cjs": `
      exports.declared = void 0;
      exports.declared = "assigned";
      exports["computed" + ""] = "runtime only";
      if (${NEVER}) exports.missing = 1;
    `,
    "entry.mjs": `
      import { declared, computed, missing } from "./mod.cjs";
      import * as ns from "./mod.cjs";
      console.log(JSON.stringify({ declared, computed, missing: typeof missing, keys: Object.keys(ns) }));
    `,
  });
  expect(result).toEqual({
    declared: "assigned",
    computed: "runtime only",
    missing: "undefined",
    keys: ["computed", "declared", "default", "missing"],
  });
});

test.concurrent("exports['string-key'] and Object.defineProperty are detected", async () => {
  const result = await runJSON({
    "mod.cjs": `
      exports["kebab-case"] = 1;
      if (${NEVER}) exports["maybe-kebab"] = 2;
      if (${NEVER}) Object.defineProperty(exports, "definedValue", { value: 3 });
      if (${NEVER}) Object.defineProperty(exports, "definedGetter", { enumerable: true, get: function () { return exports.x; } });
      Object.defineProperty(exports, "setterOnly", { set(v) {} });
      Object.defineProperty(exports, "present", { enumerable: true, get: function () { return 4; } });
    `,
    "entry.mjs": `
      import { "kebab-case" as kebab, "maybe-kebab" as maybeKebab, definedValue, definedGetter, present } from "./mod.cjs";
      import * as ns from "./mod.cjs";
      console.log(JSON.stringify({
        kebab,
        maybeKebab: typeof maybeKebab,
        definedValue: typeof definedValue,
        definedGetter: typeof definedGetter,
        present,
        keys: Object.keys(ns),
      }));
    `,
  });
  expect(result).toEqual({
    kebab: 1,
    maybeKebab: "undefined",
    definedValue: "undefined",
    definedGetter: "undefined",
    present: 4,
    keys: ["default", "definedGetter", "definedValue", "kebab-case", "maybe-kebab", "present"],
  });
});

test.concurrent("module.exports = { ... } contributes its keys and spread require()s", async () => {
  const result = await runJSON({
    "leaf.cjs": `exports.leaf = "leaf"; if (${NEVER}) exports.leafMaybe = 1;`,
    // leaf.cjs is loaded (re-exports are only followed into loaded modules),
    // but nothing from the object literal ever reaches module.exports.
    "mod.cjs": `
      const helper = () => {};
      require("./leaf.cjs");
      if (${NEVER}) module.exports = { helper, "quoted": helper, ...require("./leaf.cjs") };
      module.exports.actual = true;
    `,
    "entry.mjs": `
      import { helper, quoted, leaf, leafMaybe, actual } from "./mod.cjs";
      import * as ns from "./mod.cjs";
      console.log(JSON.stringify({
        helper: typeof helper,
        quoted: typeof quoted,
        leaf: typeof leaf,
        leafMaybe: typeof leafMaybe,
        actual,
        keys: Object.keys(ns),
      }));
    `,
  });
  expect(result).toEqual({
    helper: "undefined",
    quoted: "undefined",
    leaf: "undefined",
    leafMaybe: "undefined",
    actual: true,
    keys: ["actual", "default", "helper", "leaf", "leafMaybe", "quoted"],
  });
});

test.concurrent("names flow through module.exports = require() and __exportStar()", async () => {
  const result = await runJSON({
    "cond.cjs": `exports.always = 1; if (${NEVER}) exports.debugOnly = 1;`,
    "reexport.cjs": `module.exports = require("./cond.cjs");`,
    "star.cjs": `
      var __exportStar = function (m, e) { for (var p in m) if (p !== "default") e[p] = m[p]; };
      __exportStar(require("./cond.cjs"), exports);
      exports.own = true;
    `,
    "nested.cjs": `module.exports = require("./reexport.cjs");`,
    "entry.mjs": `
      import { always as a1, debugOnly as d1 } from "./reexport.cjs";
      import { always as a2, debugOnly as d2, own } from "./star.cjs";
      import { always as a3, debugOnly as d3 } from "./nested.cjs";
      import * as star from "./star.cjs";
      console.log(JSON.stringify({
        reexport: [a1, typeof d1],
        star: [a2, typeof d2, own],
        nested: [a3, typeof d3],
        starKeys: Object.keys(star),
      }));
    `,
  });
  expect(result).toEqual({
    reexport: [1, "undefined"],
    star: [1, "undefined", true],
    nested: [1, "undefined"],
    starKeys: ["always", "debugOnly", "default", "own"],
  });
});

test.concurrent("a later module.exports assignment discards earlier re-exports, like the lexer", async () => {
  const result = await runJSON({
    "prod.cjs": `exports.shared = "prod"; if (${NEVER}) exports.prodOnly = 1;`,
    "dev.cjs": `exports.shared = "dev"; if (${NEVER}) exports.devOnly = 1;`,
    "mod.cjs": `
      if (${NEVER}) module.exports = require("./prod.cjs");
      else module.exports = require("./dev.cjs");
      if (${NEVER}) require("./prod.cjs");
    `,
    "entry.mjs": `
      import { shared, devOnly } from "./mod.cjs";
      import * as ns from "./mod.cjs";
      console.log(JSON.stringify({ shared, devOnly: typeof devOnly, keys: Object.keys(ns) }));
    `,
  });
  expect(result).toEqual({ shared: "dev", devOnly: "undefined", keys: ["default", "devOnly", "shared"] });
});

test.concurrent("re-exports that cannot be resolved or were never loaded are skipped", async () => {
  const result = await runJSON({
    "never-loaded.cjs": `exports.neverLoaded = 1;`,
    "mod.cjs": `
      exports.ok = 1;
      if (${NEVER}) exports.okMaybe = 1;
      if (${NEVER}) module.exports = require("./does-not-exist.cjs");
      if (${NEVER}) module.exports = require("./never-loaded.cjs");
    `,
    "entry.mjs": `
      import { ok, okMaybe } from "./mod.cjs";
      import * as ns from "./mod.cjs";
      console.log(JSON.stringify({ ok, okMaybe: typeof okMaybe, keys: Object.keys(ns) }));
    `,
  });
  expect(result).toEqual({ ok: 1, okMaybe: "undefined", keys: ["default", "ok", "okMaybe"] });
});

test.concurrent("re-export cycles terminate", async () => {
  const result = await runJSON({
    "a.cjs": `
      require("./b.cjs");
      exports.a = 1;
      if (${NEVER}) exports.aMaybe = 1;
      if (${NEVER}) module.exports = require("./b.cjs");
    `,
    "b.cjs": `
      exports.b = 1;
      if (${NEVER}) exports.bMaybe = 1;
      if (${NEVER}) module.exports = require("./a.cjs");
    `,
    "entry.mjs": `
      import { a, aMaybe, b, bMaybe } from "./a.cjs";
      console.log(JSON.stringify([a, typeof aMaybe, typeof b, typeof bMaybe]));
    `,
  });
  expect(result).toEqual([1, "undefined", "undefined", "undefined"]);
});

test.concurrent("works when the module was require()d before it was imported", async () => {
  const result = await runJSON({
    "cond.cjs": `exports.always = 1; if (${NEVER}) exports.debugOnly = 1;`,
    "entry.mjs": `
      import { createRequire } from "node:module";
      const required = createRequire(import.meta.url)("./cond.cjs");
      const ns = await import("./cond.cjs");
      console.log(JSON.stringify({
        required,
        keys: Object.keys(ns),
        debugOnly: typeof ns.debugOnly,
        sameObject: ns.default === required,
      }));
    `,
  });
  expect(result).toEqual({
    required: { always: 1 },
    keys: ["always", "debugOnly", "default"],
    debugOnly: "undefined",
    sameObject: true,
  });
});

test.concurrent("export * from a CommonJS module includes the detected names", async () => {
  const result = await runJSON({
    "cond.cjs": `exports.always = 1; if (${NEVER}) exports.debugOnly = 1;`,
    "barrel.mjs": `export * from "./cond.cjs";`,
    "entry.mjs": `
      import { always, debugOnly } from "./barrel.mjs";
      import * as barrel from "./barrel.mjs";
      console.log(JSON.stringify({ always, debugOnly: typeof debugOnly, keys: Object.keys(barrel) }));
    `,
  });
  expect(result).toEqual({ always: 1, debugOnly: "undefined", keys: ["always", "debugOnly"] });
});

test.concurrent("TypeScript `export =` participates", async () => {
  const result = await runJSON({
    "cond.cjs": `exports.always = 1; if (${NEVER}) exports.debugOnly = 1;`,
    "reexport.cts": `export = require("./cond.cjs");`,
    "entry.mjs": `
      import { always, debugOnly } from "./reexport.cts";
      console.log(JSON.stringify([always, typeof debugOnly]));
    `,
  });
  expect(result).toEqual([1, "undefined"]);
});

test.concurrent("default and __esModule keep their evaluated meaning", async () => {
  const result = await runJSON({
    "mod.cjs": `
      if (${NEVER}) Object.defineProperty(exports, "__esModule", { value: true });
      if (${NEVER}) exports.default = "never";
      if (${NEVER}) exports.other = 1;
      exports.real = 1;
    `,
    "entry.mjs": `
      import def, { other } from "./mod.cjs";
      import * as ns from "./mod.cjs";
      console.log(JSON.stringify({ def, other: typeof other, keys: Object.keys(ns), esModule: typeof ns.__esModule }));
    `,
  });
  expect(result).toEqual({
    def: { real: 1 },
    other: "undefined",
    keys: ["default", "other", "real"],
    esModule: "undefined",
  });
});

test.concurrent("a name that is neither detected nor evaluated is still a link error", async () => {
  using dir = tempDir("cjs-static-exports", {
    "mod.cjs": `
      exports.real = 1;
      if (${NEVER}) exports.detected = 1;
      const key = "dyn" + "amic";
      exports[key] = 1;
    `,
    "entry.mjs": `import { real, detected, nope } from "./mod.cjs"; console.log(real, detected);`,
  });
  const { stderr, exitCode } = await runEntry(String(dir));
  expect(stderr).toContain("SyntaxError: Export named 'nope' not found in module");
  expect(exitCode).toBe(1);
});

test.concurrent("detected names survive the runtime transpiler cache", async () => {
  // Files under 4 KiB are never cached; pad past that.
  const padding = Array.from({ length: 300 }, (_, i) => `exports.pad_${i} = ${i};`).join("\n");
  using dir = tempDir("cjs-static-exports-cache", {
    "big.cjs": `exports.always = 1;\nif (${NEVER}) exports.debugOnly = 1;\n${padding}\n`,
    "entry.mjs": `
      import { always, debugOnly, pad_299 } from "./big.cjs";
      console.log(JSON.stringify([always, typeof debugOnly, pad_299]));
    `,
  });
  const env = {
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), ".cache"),
    // Debug builds discard cache hits unless this is set.
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };

  // The first run writes the cache entry, the second run links from it.
  for (let i = 0; i < 2; i++) {
    const { stdout, stderr, exitCode } = await runEntry(String(dir), env);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([1, "undefined", 299]);
    expect(exitCode).toBe(0);
    expect(readdirSync(env.BUN_RUNTIME_TRANSPILER_CACHE_PATH).filter(name => name.endsWith(".pile"))).toHaveLength(1);
  }
});
