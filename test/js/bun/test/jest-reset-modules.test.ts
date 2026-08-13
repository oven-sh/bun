// https://github.com/oven-sh/bun/issues/5356
// jest.resetModules is not a function in bun:test
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTestFile(prefix: string, files: Record<string, string>, extraArgs: string[] = []) {
  const testFile = Object.keys(files).find(f => f.endsWith(".test.ts") || f.endsWith(".test.cjs"))!;
  using dir = tempDir(prefix, files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extraArgs, testFile],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { output: stdout + stderr, exitCode };
}

describe.concurrent("jest.resetModules", () => {
  test("exists and is chainable on jest and vi", async () => {
    const { output, exitCode } = await runTestFile("jest-reset-modules-exists", {
      "exists.test.ts": `
        import { jest, vi, test, expect } from "bun:test";

        test("callable", () => {
          expect(typeof jest.resetModules).toBe("function");
          expect(typeof vi.resetModules).toBe("function");
          expect(jest.resetModules()).toBe(jest);
          expect(vi.resetModules()).toBe(vi);
        });
      `,
    });
    expect(output).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("require() returns a fresh module after resetModules()", async () => {
    const { output, exitCode } = await runTestFile("jest-reset-modules-cjs", {
      "counter.cjs": `
        let count = 0;
        module.exports = {
          increment: () => ++count,
          get: () => count,
        };
      `,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";

        test("fresh CJS module after resetModules", () => {
          const c1 = require("./counter.cjs");
          c1.increment();
          c1.increment();
          expect(c1.get()).toBe(2);
          expect(require("./counter.cjs")).toBe(c1);

          jest.resetModules();

          const c2 = require("./counter.cjs");
          expect(c2).not.toBe(c1);
          expect(c2.get()).toBe(0);
        });
      `,
    });
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("dynamic import() returns a fresh module after resetModules()", async () => {
    const { output, exitCode } = await runTestFile("jest-reset-modules-esm", {
      "state.ts": `
        export const value = { n: 0 };
      `,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";

        test("fresh ESM module after resetModules", async () => {
          const m1 = await import("./state.ts");
          m1.value.n = 5;
          const m1b = await import("./state.ts");
          expect(m1b).toBe(m1);
          expect(m1b.value.n).toBe(5);

          jest.resetModules();

          const m2 = await import("./state.ts");
          expect(m2).not.toBe(m1);
          expect(m2.value.n).toBe(0);
        });
      `,
    });
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("the next load re-reads a file rewritten on disk, also under --isolate", async () => {
    const files = {
      "shared.ts": `export const v = "v1";\n`,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";
        import { writeFileSync } from "node:fs";

        test("sees the rewritten file after resetModules", async () => {
          expect((await import("./shared.ts")).v).toBe("v1");
          writeFileSync(new URL("./shared.ts", import.meta.url), 'export const v = "v2";\\n');

          jest.resetModules();

          expect((await import("./shared.ts")).v).toBe("v2");
        });
      `,
    };
    const [plain, isolated] = await Promise.all([
      runTestFile("jest-reset-modules-reread", files),
      runTestFile("jest-reset-modules-reread-isolate", files, ["--isolate"]),
    ]);
    expect(plain.output).toContain("1 pass");
    expect(plain.output).toContain("0 fail");
    expect(plain.exitCode).toBe(0);
    expect(isolated.output).toContain("1 pass");
    expect(isolated.output).toContain("0 fail");
    expect(isolated.exitCode).toBe(0);
  });

  test("module mocks survive resetModules() and the factory is not re-run", async () => {
    const { output, exitCode } = await runTestFile("jest-reset-modules-mock", {
      "dep.cjs": `
        module.exports = { real: true };
      `,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";

        test("mock still applied after resetModules", () => {
          let factoryCalls = 0;
          jest.mock("./dep.cjs", () => {
            factoryCalls++;
            return { real: false, fn: jest.fn() };
          });
          const first = require("./dep.cjs");
          first.fn();
          expect(first.real).toBe(false);
          expect(factoryCalls).toBe(1);

          jest.resetModules();

          // The module is rebuilt from the object the factory returned the
          // first time: same exports, same mock functions, call history intact.
          const second = require("./dep.cjs");
          expect(second.real).toBe(false);
          expect(second.fn).toBe(first.fn);
          expect(second.fn).toHaveBeenCalledTimes(1);
          expect(factoryCalls).toBe(1);
        });
      `,
    });
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // The bounds below follow the other heapStats tests in this directory: they
  // leave room for the odd object conservative stack scanning keeps alive.
  test("modules evicted by resetModules() are collectable on the import() path", async () => {
    const { output, exitCode } = await runTestFile("jest-reset-modules-heap-esm", {
      "leaf.ts": `
        export const leaf = {};
      `,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";
        import { heapStats } from "bun:jsc";

        const N = 100;
        function liveModuleRecords() {
          Bun.gc(true);
          Bun.gc(true);
          return heapStats().objectTypeCounts.ModuleRecord ?? 0;
        }

        test("import() path", async () => {
          await import("./leaf.ts");
          jest.resetModules();
          const before = liveModuleRecords();

          for (let i = 0; i < N; i++) {
            await import("./leaf.ts");
            jest.resetModules();
          }

          expect(liveModuleRecords() - before).toBeLessThan(N * 0.1);
        });
      `,
    });
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("modules evicted by resetModules() stay reachable from the requirer's module.children", async () => {
    const { output, exitCode } = await runTestFile("jest-reset-modules-heap-cjs", {
      "leaf.cjs": `
        module.exports = {};
      `,
      "reset.test.cjs": `
        const { jest, test, expect } = require("bun:test");
        const { heapStats } = require("bun:jsc");

        const N = 100;
        function liveModules() {
          Bun.gc(true);
          Bun.gc(true);
          return heapStats().objectTypeCounts.Module ?? 0;
        }

        test("require() path", () => {
          require("./leaf.cjs");
          jest.resetModules();
          module.children = [];
          const before = liveModules();

          for (let i = 0; i < N; i++) {
            require("./leaf.cjs");
            jest.resetModules();
          }

          // Same as delete require.cache[id]: the evicted modules are still
          // listed in the children of the module that required them.
          expect(module.children.length).toBe(N);
          expect(liveModules() - before).toBeGreaterThan(N * 0.9);

          // Dropping that list is what lets them go.
          module.children = [];
          expect(liveModules() - before).toBeLessThan(N * 0.1);
        });
      `,
    });
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
