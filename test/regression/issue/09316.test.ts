// https://github.com/oven-sh/bun/issues/9316
//
// mock.module() patches the live bindings of its target, but a dependent that
// already evaluated and captured a value (e.g. `const x = new Imported()` at
// module scope) keeps the real value. When the target had already been loaded
// by an earlier test file, mock.module() must evict cached dependents so a
// subsequent import/require re-evaluates them against the mock.
import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

function fakeStoragePkg(): Record<string, string> {
  return {
    "node_modules/fake-storage/package.json": JSON.stringify({ name: "fake-storage", main: "./index.js" }),
    "node_modules/fake-storage/index.js": /* js */ `
      class Storage {
        bucket() { return { file() { return { write() { return "real-write" } } } } }
      }
      module.exports = { Storage };
    `,
  };
}

async function runBunTest(dir: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("mock.module evicts cached dependents", () => {
  test("ESM dependent cached by an earlier test file", async () => {
    using dir = tempDir("mock-module-9316-esm", {
      ...fakeStoragePkg(),
      "src/app.ts": /* ts */ `
        import { Storage } from "fake-storage";
        const storage = new Storage();
        export const upload = (f: string, d: string) => storage.bucket().file(f).write(d);
      `,
      "tests/a.test.ts": /* ts */ `
        import { test } from "bun:test";
        import { upload } from "../src/app";
        test("a", () => { upload("x", "y"); });
      `,
      "tests/storage.test.ts": /* ts */ `
        import { describe, test, expect, mock, jest } from "bun:test";
        describe("storage", async () => {
          mock.module("fake-storage", () => ({
            Storage: jest.fn(() => ({
              bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
            })),
          }));
          const { upload } = await import("../src/app");
          test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
        });
      `,
    });

    const { stdout, stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).not.toContain("real-write");
    expect(exitCode).toBe(0);
  });

  test("CJS dependent cached by an earlier test file", async () => {
    using dir = tempDir("mock-module-9316-cjs", {
      ...fakeStoragePkg(),
      "src/app.cjs": /* js */ `
        const { Storage } = require("fake-storage");
        const storage = new Storage();
        module.exports.upload = (f, d) => storage.bucket().file(f).write(d);
      `,
      "tests/a.test.ts": /* ts */ `
        import { test } from "bun:test";
        const { upload } = require("../src/app.cjs");
        test("a", () => { upload("x", "y"); });
      `,
      "tests/storage.test.ts": /* ts */ `
        import { test, expect, mock, jest } from "bun:test";
        mock.module("fake-storage", () => ({
          Storage: jest.fn(() => ({
            bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
          })),
        }));
        const { upload } = require("../src/app.cjs");
        test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
      `,
    });

    const { stdout, stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).not.toContain("real-write");
    expect(exitCode).toBe(0);
  });

  test("transitive dependent (mocked -> wrapper -> app)", async () => {
    using dir = tempDir("mock-module-9316-transitive", {
      ...fakeStoragePkg(),
      "src/wrapper.ts": /* ts */ `
        import { Storage } from "fake-storage";
        export const makeStorage = () => new Storage();
      `,
      "src/app.ts": /* ts */ `
        import { makeStorage } from "./wrapper";
        const storage = makeStorage();
        export const upload = (f: string, d: string) => storage.bucket().file(f).write(d);
      `,
      "tests/a.test.ts": /* ts */ `
        import { test } from "bun:test";
        import { upload } from "../src/app";
        test("a", () => { upload("x", "y"); });
      `,
      "tests/storage.test.ts": /* ts */ `
        import { test, expect, mock, jest } from "bun:test";
        mock.module("fake-storage", () => ({
          Storage: jest.fn(() => ({
            bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
          })),
        }));
        const { upload } = await import("../src/app");
        test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
      `,
    });

    const { stdout, stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).not.toContain("real-write");
    expect(exitCode).toBe(0);
  });
});
