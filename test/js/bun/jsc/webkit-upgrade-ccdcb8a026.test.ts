import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for the WebKit ccdcb8a026 sync (oven-sh/WebKit#614). Each case pins an
// observable difference between the old and the new JavaScriptCore. The last case
// exercises the GlobalObjectMethodTable::moduleTypeIsAllowed slot the range adds: a
// host-defined import attribute type must still reach Bun's module loader.

describe.concurrent("WebKit ccdcb8a026 upgrade", () => {
  test("Array.prototype.toSpliced throws RangeError for a new length of 2^53 - 1 (c8c37314ee)", () => {
    expect(() => Array.prototype.toSpliced.call({ length: Infinity }, 0, 0)).toThrow(RangeError);
    // One past 2^53 - 1 is still the TypeError from step 10 of the spec algorithm.
    expect(() => Array.prototype.toSpliced.call({ length: 2 ** 53 - 1 }, 0, 0, 1)).toThrow(TypeError);
  });

  test("Atomics.isLockFree uses ToIntegerOrInfinity instead of wrapping to int32 (41294576ac)", () => {
    expect(Atomics.isLockFree(4)).toBe(true);
    expect(Atomics.isLockFree(4294967297)).toBe(false);
    expect(Atomics.isLockFree(2 ** 32 + 4)).toBe(false);
  });

  test("RegExp.escape keeps supplementary code points whose low 16 bits look like syntax characters (b44e00d2f0)", () => {
    // U+2002A has 0x002A ('*') in its low 16 bits and U+20009 has 0x0009 (TAB).
    expect(RegExp.escape("\u{2002A}")).toBe("\u{2002A}");
    expect(RegExp.escape("\u{20009}")).toBe("\u{20009}");
    expect(RegExp.escape("*")).toBe("\\*");
  });

  test("a strict async generator body does not tail-call its return expression (4fa7b55ae4)", async () => {
    async function* g() {
      "use strict";
      return Promise.resolve(42);
    }
    const result = await g().next();
    expect(result).toEqual({ value: 42, done: true });
  });

  test("host-defined import attribute types still load through Bun's module loader (64168e4d90)", async () => {
    using dir = tempDir("wk-module-type", {
      "data.toml": `name = "bun"\n`,
      "note.txt": `hello`,
      "entry.mjs": `
        import data from "./data.toml" with { type: "toml" };
        import note from "./note.txt" with { type: "text" };
        const dynamic = await import("./data.toml", { with: { type: "toml" } });
        process.stdout.write(JSON.stringify({ name: data.name, note, dynamic: dynamic.default.name }));
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
    expect(JSON.parse(stdout)).toEqual({ name: "bun", note: "hello", dynamic: "bun" });
    expect(exitCode).toBe(0);
  });
});
