// https://github.com/oven-sh/bun/issues/9316
import { describe, expect, test } from "bun:test";
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

async function runBunTest(dir: string, files: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...files],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out: stderr + stdout, exitCode };
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
      "a.test.ts": /* ts */ `
        import { test, expect } from "bun:test";
        import { upload } from "./src/app";
        test("a sees real", () => expect(upload("x", "y")).toBe("real-write"));
      `,
      "storage.test.ts": /* ts */ `
        import { describe, test, expect, mock, jest } from "bun:test";
        describe("storage", async () => {
          mock.module("fake-storage", () => ({
            Storage: jest.fn(() => ({
              bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
            })),
          }));
          const { upload } = await import("./src/app");
          test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
        });
      `,
    });

    const { out, exitCode } = await runBunTest(String(dir), ["a.test.ts", "storage.test.ts"]);
    expect(out).toContain("2 pass");
    expect(out).toContain("0 fail");
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
      "a.test.ts": /* ts */ `
        import { test, expect } from "bun:test";
        const { upload } = require("./src/app.cjs");
        test("a sees real", () => expect(upload("x", "y")).toBe("real-write"));
      `,
      "storage.test.ts": /* ts */ `
        import { test, expect, mock, jest } from "bun:test";
        mock.module("fake-storage", () => ({
          Storage: jest.fn(() => ({
            bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
          })),
        }));
        const { upload } = require("./src/app.cjs");
        test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
      `,
    });

    const { out, exitCode } = await runBunTest(String(dir), ["a.test.ts", "storage.test.ts"]);
    expect(out).toContain("2 pass");
    expect(out).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("CJS dependent that require()s an ESM intermediate", async () => {
    using dir = tempDir("mock-module-9316-cjs-req-esm", {
      ...fakeStoragePkg(),
      "src/helper.ts": /* ts */ `
        import { Storage } from "fake-storage";
        export const helper = new Storage();
      `,
      "src/app.cjs": /* js */ `
        const { helper } = require("./helper.ts");
        module.exports.upload = (f, d) => helper.bucket().file(f).write(d);
      `,
      "a.test.ts": /* ts */ `
        import { test, expect } from "bun:test";
        const { upload } = require("./src/app.cjs");
        test("a sees real", () => expect(upload("x", "y")).toBe("real-write"));
      `,
      "storage.test.ts": /* ts */ `
        import { test, expect, mock, jest } from "bun:test";
        mock.module("fake-storage", () => ({
          Storage: jest.fn(() => ({
            bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
          })),
        }));
        const { upload } = require("./src/app.cjs");
        test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
      `,
    });

    const { out, exitCode } = await runBunTest(String(dir), ["a.test.ts", "storage.test.ts"]);
    expect(out).toContain("2 pass");
    expect(out).toContain("0 fail");
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
      "a.test.ts": /* ts */ `
        import { test, expect } from "bun:test";
        import { upload } from "./src/app";
        test("a sees real", () => expect(upload("x", "y")).toBe("real-write"));
      `,
      "storage.test.ts": /* ts */ `
        import { test, expect, mock, jest } from "bun:test";
        mock.module("fake-storage", () => ({
          Storage: jest.fn(() => ({
            bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
          })),
        }));
        const { upload } = await import("./src/app");
        test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
      `,
    });

    const { out, exitCode } = await runBunTest(String(dir), ["a.test.ts", "storage.test.ts"]);
    expect(out).toContain("2 pass");
    expect(out).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("unrelated cached modules are not evicted", async () => {
    using dir = tempDir("mock-module-9316-unrelated", {
      ...fakeStoragePkg(),
      "src/app.ts": /* ts */ `
        import { Storage } from "fake-storage";
        const storage = new Storage();
        export const upload = (f: string, d: string) => storage.bucket().file(f).write(d);
      `,
      "src/unrelated.ts": /* ts */ `
        globalThis.__evals = (globalThis.__evals ?? 0) + 1;
        export const evals = () => globalThis.__evals;
      `,
      "src/unrelated.cjs": /* js */ `
        globalThis.__cjsEvals = (globalThis.__cjsEvals ?? 0) + 1;
        module.exports.evals = () => globalThis.__cjsEvals;
      `,
      "a.test.ts": /* ts */ `
        import { test, expect } from "bun:test";
        import { upload } from "./src/app";
        import { evals } from "./src/unrelated";
        require("./src/unrelated.cjs");
        test("a sees real", () => expect(upload("x", "y")).toBe("real-write"));
        test("a evals once", () => expect(evals()).toBe(1));
      `,
      "storage.test.ts": /* ts */ `
        import { test, expect, mock, jest } from "bun:test";
        mock.module("fake-storage", () => ({
          Storage: jest.fn(() => ({
            bucket: () => ({ file: () => ({ write: () => "mocked-write" }) }),
          })),
        }));
        const { upload } = await import("./src/app");
        const { evals } = await import("./src/unrelated");
        const cjs = require("./src/unrelated.cjs");
        test("uses mock", () => expect(upload("t", "h")).toBe("mocked-write"));
        test("esm unrelated not re-evaluated", () => expect(evals()).toBe(1));
        test("cjs unrelated not re-evaluated", () => expect(cjs.evals()).toBe(1));
      `,
    });

    const { out, exitCode } = await runBunTest(String(dir), ["a.test.ts", "storage.test.ts"]);
    expect(out).toContain("5 pass");
    expect(out).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
