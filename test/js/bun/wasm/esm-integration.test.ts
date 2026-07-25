// https://github.com/oven-sh/bun/issues/12434
// https://github.com/oven-sh/bun/issues/30369
//
// `import * as m from "./file.wasm"` (and `await import("./file.wasm")`) used
// to resolve to `{ __esModule: true, default: "<path>" }` because the .wasm
// loader fell through to the .file loader. Node with --experimental-wasm-modules
// (the WebAssembly/ESM integration proposal) instantiates the module and
// exposes its exports as named ES module exports.
//
// Existing asset-path behaviour is preserved for `?query` specifiers (see
// #16476) and for `require("./x.wasm")`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Exports `add(i32,i32)->i32` and `memory`. No imports, so ESM integration
// instantiates it with an empty import object.
const addWasmBytes = readFileSync(join(import.meta.dir, "add.wasm"));

// Imports `jsFn`/`jsInitFn` from "./wasm-dep.mjs"; exports `add`/`addImported`.
// Exercises the wasm → JS module dependency path (Bun resolving a .wasm-keyed
// referrer and linking JS exports into wasm import bindings).
const simpleWasmBytes = readFileSync(
  join(import.meta.dir, "..", "..", "node", "test", "fixtures", "es-modules", "simple.wasm"),
);

describe("wasm ES module integration (#12434)", () => {
  test.concurrent("dynamic import exposes wasm exports as named ES module exports", async () => {
    using dir = tempDir("wasm-esm-dynamic", {
      "add.wasm": addWasmBytes,
      "index.js": `
        const m = await import("./add.wasm");
        console.log(JSON.stringify({
          add: typeof m.add,
          memory: m.memory?.constructor?.name,
          addResult: m.add(2, 3),
          hasDefault: "default" in m,
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      add: "function",
      memory: "Memory",
      addResult: 5,
      hasDefault: false,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("static `import * as` exposes wasm exports as named ES module exports", async () => {
    using dir = tempDir("wasm-esm-static", {
      "add.wasm": addWasmBytes,
      "index.js": `
        import * as wasm from "./add.wasm";
        console.log(JSON.stringify({
          keys: Object.keys(wasm).sort(),
          add: typeof wasm.add,
          memory: wasm.memory?.constructor?.name,
          result: wasm.add(10, 32),
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      keys: ["add", "memory"],
      add: "function",
      memory: "Memory",
      result: 42,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("wasm modules can import from JS modules", async () => {
    using dir = tempDir("wasm-esm-imports", {
      "simple.wasm": simpleWasmBytes,
      "wasm-dep.mjs": `
        export function jsFn() { return 42; }
        export function jsInitFn() {}
      `,
      "index.js": `
        import * as m from "./simple.wasm";
        console.log(JSON.stringify({
          keys: Object.keys(m).sort(),
          add: m.add(3, 4),
          addImported: m.addImported(10),
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      keys: ["add", "addImported"],
      add: 7,
      addImported: 52,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("named imports from a wasm module work", async () => {
    using dir = tempDir("wasm-esm-named", {
      "add.wasm": addWasmBytes,
      "index.js": `
        import { add } from "./add.wasm";
        console.log(add(100, 23));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("123");
    expect(exitCode).toBe(0);
  });

  test.concurrent("`?query` on a .wasm specifier keeps the legacy path-as-default behaviour (#16476)", async () => {
    using dir = tempDir("wasm-query-path", {
      "add.wasm": addWasmBytes,
      "index.js": `
        const m = await import("./add.wasm?1");
        console.log(JSON.stringify({
          default: m.default,
          __esModule: m.__esModule,
          hasAdd: typeof m.add,
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.__esModule).toBe(true);
    expect(parsed.hasAdd).toBe("undefined");
    expect(parsed.default).toMatch(/add\.wasm$/);
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "`with { type: 'file' }` on a .wasm specifier keeps the legacy path-as-default behaviour",
    async () => {
      using dir = tempDir("wasm-type-file", {
        "add.wasm": addWasmBytes,
        "index.js": `
        const m = await import("./add.wasm", { with: { type: "file" } });
        console.log(JSON.stringify({
          default: m.default,
          hasAdd: typeof m.add,
        }));
      `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.hasAdd).toBe("undefined");
      expect(parsed.default).toMatch(/add\.wasm$/);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("require('./x.wasm') keeps the legacy path-as-value behaviour", async () => {
    using dir = tempDir("wasm-require-path", {
      "add.wasm": addWasmBytes,
      "index.cjs": `console.log(require("./add.wasm"));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toMatch(/add\.wasm$/);
    expect(exitCode).toBe(0);
  });

  test.concurrent("importing a file with a bad wasm magic header throws a load error", async () => {
    using dir = tempDir("wasm-bad-magic", {
      "bad.wasm": "not a wasm module",
      "index.js": `
        try {
          await import("./bad.wasm");
          console.log(JSON.stringify({ threw: false }));
        } catch (e) {
          console.log(JSON.stringify({
            threw: true,
            name: e?.name ?? "",
            message: String(e?.message ?? ""),
          }));
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.threw).toBe(true);
    expect(parsed.message).toMatch(/magic header/i);
    expect(exitCode).toBe(0);
  });
});
