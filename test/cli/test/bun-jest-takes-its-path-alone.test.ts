import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.jest answers the module whatever stands behind the path", async () => {
  using dir = tempDir("bun-jest-takes-its-path-alone", {
    "main.js": `const p = "/tmp/a.js"; console.log(typeof Bun.jest(p), typeof Bun.jest(p, 1), typeof Bun.jest(p, 0, 1), [p].map(Bun.jest).map(m => typeof m).join());`,
    "mapped.test.js": `import { test } from "bun:test"; test("m", () => { const [m] = [import.meta.path].map(Bun.jest); console.log("B " + typeof m.expect); });`,
  });
  for (const [args, printed] of [
    [["main.js"], "object object object object"],
    [["test", "mapped.test.js"], "B function"],
    [["test", "--aot", "mapped.test.js"], "B function"],
  ] as const) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(printed);
    expect(exitCode).toBe(0);
  }
});
