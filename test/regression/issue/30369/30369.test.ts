// https://github.com/oven-sh/bun/issues/30369
//
// `import * as m from "./file.wasm"` (and `await import("./file.wasm")`)
// used to resolve to `{ __esModule: true, default: "<path>" }` because
// the .wasm loader fell through to the .file loader's export-default
// branch. Node with --experimental-wasm-modules / the WebAssembly ESM
// integration proposal instantiates the module and exposes its exports
// as named ES module exports.
//
// The fix routes .wasm through JSC's WebAssemblySourceProvider:
// JSModuleLoader::makeModule dispatches SourceProviderSourceType::WebAssembly
// to JSWebAssembly::instantiate, which produces a module record whose
// namespace is the instance's exports object.
//
// Existing asset-path behaviour is preserved when the specifier carries a
// `?query` (see 16476) and for `require("./x.wasm")`.
import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "harness";

// The fixture exports an `add(i32,i32)->i32` function and a `memory`
// export. It has no imports, so the ESM integration can instantiate it
// with an empty import object.
const addWasmBytes = readFileSync(join(import.meta.dir, "add.wasm"));

describe("#30369 — wasm ES module integration", () => {
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      add: "function",
      memory: "Memory",
      addResult: 5,
      // Node's ESM wasm integration does not emit a `default` export;
      // once we route through WebAssemblySourceProvider JSC produces a
      // module record whose namespace is only the instance exports.
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      keys: ["add", "memory"],
      add: "function",
      memory: "Memory",
      result: 42,
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("123");
    expect(exitCode).toBe(0);
  });

  test.concurrent("`?query` on a .wasm specifier keeps the legacy path-as-default behaviour (see #16476)", async () => {
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.__esModule).toBe(true);
    expect(parsed.hasAdd).toBe("undefined");
    expect(parsed.default).toMatch(/add\.wasm$/);
    expect(exitCode).toBe(0);
  });

  test.concurrent("require('./x.wasm') keeps the legacy path-as-value behaviour", async () => {
    using dir = tempDir("wasm-require-path", {
      "add.wasm": addWasmBytes,
      "index.js": `console.log(require("./add.wasm"));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
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
          console.log("UNEXPECTED_OK");
        } catch (e) {
          console.log("THREW");
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
    const [stdout, , exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout.trim()).toBe("THREW");
    expect(exitCode).toBe(0);
  });
});
