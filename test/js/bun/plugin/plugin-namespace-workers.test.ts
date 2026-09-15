import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

describe("Bun.plugin namespace validation", () => {
  // Run the setup() body and return the error message thrown by the first
  // onLoad/onResolve call, or "" if none was thrown. We catch here so each
  // case exercises a fresh call into the validator.
  const errorFor = (setup: (b: import("bun").PluginBuilder) => void): string => {
    try {
      Bun.plugin({ name: "ns-validation", setup });
      return "";
    } catch (e) {
      return String((e as Error).message);
    }
  };

  test.each([
    ["abc", true],
    ["abc-def", true],
    ["abc_def", true],
    ["a/b", true],
    ["@scope/pkg", true],
    ["A_Z-0/9", true],
    ["x", true],
    ["0", true],
    ["/", true],
    ["@", true],
    ["-", true],
    ["_", true],
    ["abcABC012/@_-", true],

    ["", false],
    ["bad ns", false],
    ["bad!", false],
    ["a.b", false],
    ["a:b", false],
    ["a+b", false],
    ["a\nb", false],
    ["a\tb", false],
    ["héllo", false],
    ["a😀b", false],
    ["a\0b", false],
  ])("onLoad/onResolve namespace %j (valid: %p)", (ns, ok) => {
    const expected = ok ? "" : "namespace can only contain letters, numbers, dashes, or underscores";
    expect({
      onLoad: errorFor(b => b.onLoad({ filter: /.*/, namespace: ns }, () => ({ contents: "", loader: "js" }))),
      onResolve: errorFor(b => b.onResolve({ filter: /.*/, namespace: ns }, ({ path }) => ({ path, namespace: ns }))),
    }).toEqual({
      onLoad: expected,
      onResolve: expected,
    });
  });

  test("is safe to call concurrently from workers", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "plugin-namespace-workers-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is captured for diagnostics only; debug/ASAN builds may emit benign noise.
    expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode, stderr }).toEqual({
      stdout: "PASS",
      exitCode: 0,
      signalCode: null,
      stderr: expect.any(String),
    });
  });
});
