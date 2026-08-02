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

  test("cyclic Array.prototype.join throws RangeError (f2f2c2ddf637)", () => {
    // StringRecursionChecker was removed; cyclic join now recurses until the
    // stack check throws instead of short-circuiting to the empty string.
    const a: unknown[] = [];
    a.push(a);
    expect(() => a.join()).toThrow(RangeError);
  });

  test("WebAssembly.Exception gains options.traceStack and stack getter (bf6512f84f7d)", () => {
    expect(WebAssembly.Exception.length).toBe(2);
    const desc = Object.getOwnPropertyDescriptor(WebAssembly.Exception.prototype, "stack");
    expect(typeof desc?.get).toBe("function");
  });

  test("indirect, namespace and star re-exports link (BunAnalyzeTranspiledModule + 90b2ecf79ae3)", async () => {
    // Upstream now threads ScriptFetchParameters::Type through createIndirect /
    // createNamespace / addStarExportEntry and starExportEntries(). Bun's
    // analyze-module bindings supply Type::JavaScript for each; this verifies
    // the three shapes still link and resolve.
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
});
