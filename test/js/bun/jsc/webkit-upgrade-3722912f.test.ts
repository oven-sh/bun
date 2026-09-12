import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for the WebKit 3722912ff800 sync (oven-sh/WebKit#383). Each case
// pins an observable behavior difference so the gate can distinguish the old
// JSC from the new one, and the re-export cases exercise the
// ScriptFetchParameters::Type threading added to BunAnalyzeTranspiledModule.

describe.concurrent("WebKit 3722912ff800 upgrade", () => {
  test("Iterator.prototype.includes is enabled by default (319f94b3db4a)", () => {
    expect(typeof Iterator.prototype.includes).toBe("function");
    function* g() {
      yield 1;
      yield 2;
      yield 3;
    }
    expect(g().includes(2)).toBe(true);
    expect(g().includes(5)).toBe(false);
  });

  test("cyclic Array.prototype.join returns the empty string for the cycle (oven-sh/WebKit#559)", () => {
    // Upstream removed StringRecursionChecker in f2f2c2ddf637; oven-sh/WebKit#559
    // restores it for the array conversions so a self-containing array matches
    // V8 instead of throwing RangeError (oven-sh/bun#41198).
    const a: unknown[] = [1, null, 2];
    a[1] = a;
    expect(a.join()).toBe("1,,2");
    expect(a.toString()).toBe("1,,2");
    expect(a.toLocaleString()).toBe("1,,2");
    expect(`${a}`).toBe("1,,2");
  });

  test("WebAssembly.Exception gains options.traceStack and stack getter (bf6512f84f7d)", () => {
    expect(WebAssembly.Exception.length).toBe(2);
    const desc = Object.getOwnPropertyDescriptor(WebAssembly.Exception.prototype, "stack");
    expect(typeof desc?.get).toBe("function");
  });

  test("indirect, namespace and star re-exports link on the JSC ModuleAnalyzer path (90b2ecf79ae3)", async () => {
    // Upstream now threads ScriptFetchParameters::Type through createIndirect /
    // createNamespace / addStarExportEntry and starExportEntries(). This runs
    // under plain `bun run` so JSC's own ModuleAnalyzer builds the record; the
    // BunTranspiledModule path is covered by the --isolate test below.
    using dir = tempDir("wk-reexport", {
      "leaf.mjs": `export const a = 1; export const b = 2; export const c = 3;`,
      "mid.mjs": `
        export { a } from "./leaf.mjs";
        export * as ns from "./leaf.mjs";
        export * from "./leaf.mjs";
      `,
      "entry.mjs": `
        import { a, b, c, ns } from "./mid.mjs";
        process.stdout.write(JSON.stringify({ a, b, c, ns: { a: ns.a, b: ns.b, c: ns.c } }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ a: 1, b: 2, c: 3, ns: { a: 1, b: 2, c: 3 } });
    expect(exitCode).toBe(0);
  });

  test("typed import attributes resolve through BunTranspiledModule (--isolate) (90b2ecf79ae3)", async () => {
    // Upstream 90b2ecf79ae3 keys m_loadedModules on (specifier, type) and
    // ModuleAnalyzer::appendRequestedModule dedupes on that pair. Bun only
    // takes the BunTranspiledModule path under `bun test --isolate`, so
    // exercise it explicitly: without the ImportEntry/RequestedModules type
    // threading this rejects with "Imports different between
    // parseFromSourceCode and fallbackParse" in debug and null-derefs
    // in release.
    using dir = tempDir("wk-typed-import", {
      "d.json": `{"ok":true}`,
      "mid.ts": `
        import j from "./d.json" with { type: "json" };
        import * as ns from "./d.json" with { type: "json" };
        export { j, ns };
      `,
      "typed.test.ts": `
        import j from "./d.json" with { type: "json" };
        import t from "./d.json" with { type: "text" };
        import * as ns from "./d.json" with { type: "json" };
        import { j as rj, ns as rns } from "./mid.ts";
        import { test, expect } from "bun:test";
        test("typed", () => {
          expect(j).toEqual({ ok: true });
          expect(JSON.parse(t as string)).toEqual({ ok: true });
          expect(ns.default).toEqual({ ok: true });
          expect(rj).toEqual({ ok: true });
          expect(rns.default).toEqual({ ok: true });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "typed.test.ts"],
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("Imports different");
    expect(exitCode).toBe(0);
  });
});
