import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("esmRegistryMap initialization with tampered Loader", () => {
  const cases = [
    ["globalThis.Loader replaced with a primitive", `delete globalThis.Loader; globalThis.Loader = 3875;`],
    ["globalThis.Loader replaced with a plain object", `delete globalThis.Loader; globalThis.Loader = { registry: 123 };`],
    ["globalThis.Loader replaced with a throwing getter", `Object.defineProperty(globalThis, "Loader", { get() { throw new Error("boom"); } });`],
    ["Loader.registry replaced with a primitive", `Loader.registry = 123;`],
    ["Loader.registry replaced with a throwing getter", `Object.defineProperty(Loader, "registry", { get() { throw new Error("boom"); } });`],
  ] as const;

  for (const [name, setup] of cases) {
    test.concurrent(name, async () => {
      using dir = tempDir("loader-registry-tamper", {
        "dep.js": "module.exports = 42;",
        "entry.js": `${setup} try { require("./dep.js"); } catch {} console.log("ok");`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("runtime error");
      expect(stderr).not.toContain("ASSERTION FAILED");
      expect(stderr).not.toContain("panic");
      expect(stdout).toContain("ok");
      expect(proc.signalCode).toBeNull();
      // Tampering with Loader.registry may cause JSC's own module loader builtins to
      // throw a JS TypeError afterwards; that is acceptable as long as we do not crash.
      expect([0, 1]).toContain(exitCode);
    });
  }
});
