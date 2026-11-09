// `mock.module("./dep", factory)` finds the file that "./dep" is written in by the frame of its caller, and a call that
// ends a function is a tail call, which drops that frame. `bun test` keeps such a call out of tail position.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function expectFixturesToPass(files: Record<string, string>, pass: number, args: string[] = []) {
  using dir = tempDir("mock-module-tail-call", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(` ${pass} pass\n 0 fail\n`);
  expect(exitCode).toBe(0);
}

describe("mock.module() as the call that ends a function", () => {
  const factory = `const factory = where => () => ({ where });`;

  // A tail call drops the frame of the function that makes it. The test file calls each helper, so without that frame
  // "./dep" is resolved beside the test file, or nowhere if native code called the helper.
  test.concurrent("resolves a path that the call writes beside the file of a helper in another folder", async () => {
    await expectFixturesToPass(
      {
        "helpers/dep.ts": `export const where = "beside the helper";`,
        "tests/dep.ts": `export const where = "beside the test file";`,
        "helpers/mocks.ts": `
          import { mock, mock as renamed } from "bun:test";
          import { mock as ofJestGlobals } from "@jest/globals";
          ${factory}
          const nothing = () => {};

          export const arrow = () => mock.module("./dep", factory("arrow"));
          export function declared() { return mock.module("./dep", factory("declared")); }
          export const either = yes => (yes ? mock.module("./dep", factory("either")) : undefined);
          export const behindAnd = yes => yes && mock.module("./dep", factory("behindAnd"));
          export const behindOr = no => no || mock.module("./dep", factory("behindOr"));
          export const behindNullish = missing => missing ?? mock.module("./dep", factory("behindNullish"));
          export const afterComma = () => (nothing(), mock.module("./dep", factory("afterComma")));
          export const throughName = () => {
            const result = mock.module("./dep", factory("throughName"));
            return result;
          };
          export const { make: staticMethod } = class {
            static make() { return mock.module("./dep", factory("staticMethod")); }
          };
          export const underAnotherName = () => renamed.module("./dep", factory("underAnotherName"));
          export const fromJestGlobals = () => ofJestGlobals.module("./dep", factory("fromJestGlobals"));
          export const asserted = () => (mock as any).module("./dep" as string, factory("asserted"));
          export const optional = () => mock?.module("./dep", factory("optional"));
          export const byString = () => mock["module"]("./dep", factory("byString"));
          export const inTemplate = () => mock.module(\`./dep\`, factory("inTemplate"));
          export const inContinuation = () => Promise.resolve().then(() => mock.module("./dep", factory("inContinuation")));
          export function asHook() { return mock.module("./dep", factory("asHook")); }
          export const ofNoFile = () => mock.module("./no-file", factory("ofNoFile"));

          export const handedOn = (path, where) => mock.module(path, factory(where));
        `,
        "tests/shapes.test.ts": `
          import { beforeEach, describe, expect, test } from "bun:test";
          import * as mocks from "../helpers/mocks";
          import * as ofHelper from "../helpers/dep";
          import * as ofTestFile from "./dep";

          const read = () => [ofHelper.where, ofTestFile.where];

          test.each([
            ["arrow"], ["declared"], ["either", true], ["behindAnd", true], ["behindOr", false], ["behindNullish", null],
            ["afterComma"], ["throughName"], ["staticMethod"], ["underAnotherName"], ["fromJestGlobals"], ["asserted"],
            ["optional"], ["byString"], ["inTemplate"], ["inContinuation"],
          ])("%s", async (shape, ...args) => {
            await mocks[shape](...args);
            expect(read()).toEqual([shape, "beside the test file"]);
          });

          describe("the runner calls the helper", () => {
            beforeEach(mocks.asHook);
            test("as a hook", () => expect(read()).toEqual(["asHook", "beside the test file"]));
          });

          test("a path of no file is a path beside the helper too", async () => {
            mocks.ofNoFile();
            expect((await import("../helpers/no-file")).where).toBe("ofNoFile");
          });

          // A preload that lends vi.mock() as such a wrapper relies on it.
          test("a path that a wrapper is handed stays a path of the wrapper's caller", () => {
            const ofHelperBefore = ofHelper.where;
            mocks.handedOn("./dep", "handedOn");
            expect(read()).toEqual([ofHelperBefore, "handedOn"]);
          });
        `,
      },
      19,
    );
  });

  // Native code calls these, so no frame is left below the tail call and the path stays as it is written.
  test.concurrent(
    "resolves a path that the call writes beside the test file in a callback that the runner calls",
    async () => {
      await expectFixturesToPass(
        {
          "dep.ts": `export const where = "real";`,
          "node_modules/a-package/package.json": JSON.stringify({
            name: "a-package",
            type: "module",
            main: "./index.js",
          }),
          "node_modules/a-package/index.js": `export const where = "real package";`,
          "node_modules/two-files/package.json": JSON.stringify({
            name: "two-files",
            exports: { import: "./index.mjs", require: "./index.cjs" },
          }),
          "node_modules/two-files/index.mjs": `export const where = "real for import";`,
          "node_modules/two-files/index.cjs": `exports.where = "real for require";`,
          "hooks.test.ts": `
          import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
          import * as dep from "./dep";
          import * as ofPackage from "a-package";
          import * as ofTwoFiles from "two-files";
          ${factory}

          describe("a describe body", () => mock.module("./dep", factory("describe body")));
          test("a describe body", () => expect(dep.where).toBe("describe body"));

          describe("beforeAll", () => {
            beforeAll(() => mock.module("./dep", factory("beforeAll")));
            test("mocks", () => expect(dep.where).toBe("beforeAll"));
          });

          describe("beforeEach", () => {
            beforeEach(() => mock.module("./dep", factory("beforeEach")));
            test("mocks", () => expect(dep.where).toBe("beforeEach"));
          });

          describe("afterEach", () => {
            afterEach(() => mock.module("./dep", factory("afterEach")));
            test("runs its hook", () => {});
          });
          test("afterEach", () => expect(dep.where).toBe("afterEach"));

          test("a test body", () => mock.module("./dep", factory("test body")));
          test("after a test body", () => expect(dep.where).toBe("test body"));

          test.each(["a row"])("test.each with %s", row => mock.module("./dep", factory(row)));
          test("after test.each", () => expect(dep.where).toBe("a row"));

          describe("a factory that settles in a later turn of the event loop", () => {
            beforeAll(() =>
              mock.module("./dep", async () => {
                await new Promise(resolve => setImmediate(resolve));
                return { where: "later" };
              }),
            );
            test("the runner waits for what the hook returns", () => expect(dep.where).toBe("later"));
          });

          describe("a relative file: URL", () => {
            beforeAll(() => mock.module("file:./dep.ts", factory("file: URL")));
            test("mocks", () => expect(dep.where).toBe("file: URL"));
          });

          describe("a package", () => {
            beforeAll(() => mock.module("a-package", factory("package")));
            test("mocks", () => expect(ofPackage.where).toBe("package"));
          });

          describe("a package with one file for import and another for require", () => {
            beforeAll(() => mock.module("two-files", factory("package")));
            test("mocks the file that import loads, as with a block body", () => {
              expect([ofTwoFiles.where, require("two-files").where]).toEqual(["package", "real for require"]);
            });
          });
        `,
        },
        13,
      );
    },
  );

  // Without the frame the path stayed as written, and the mock replaced the "./dep" of every later test file.
  test.concurrent("resolves a path that the call writes beside a --preload script in another folder", async () => {
    const reads = (setup: string, own: string) => `
      import { expect, test } from "bun:test";
      import * as ofPreload from "${setup}/dep";
      import * as ofTestFile from "./dep";
      test("the hook of the preload script mocks the file beside it", () => {
        expect([ofPreload.where, ofTestFile.where]).toEqual(["mock", "${own}"]);
      });
    `;
    await expectFixturesToPass(
      {
        "setup/dep.ts": `export const where = "beside the preload script";`,
        "setup/preload.ts": `
          import { beforeAll, mock } from "bun:test";
          beforeAll(() => mock.module("./dep", () => ({ where: "mock" })));
        `,
        "dep.ts": `export const where = "beside the first test file";`,
        "first.test.ts": reads("./setup", "beside the first test file"),
        "other/dep.ts": `export const where = "beside the second test file";`,
        "other/second.test.ts": reads("../setup", "beside the second test file"),
      },
      2,
      ["--preload", "./setup/preload.ts", "./first.test.ts", "./other/second.test.ts"],
    );
  });

  // cline's test preload lends vi.mock() to its test files like this.
  test.concurrent("leaves a path that a wrapper of a --preload script is handed to the wrapper's caller", async () => {
    await expectFixturesToPass(
      {
        "setup/dep.ts": `export const where = "beside the preload script";`,
        "setup/preload.ts": `
          import { mock, vi } from "bun:test";
          vi.mock = (path, factory) => mock.module(path, () => factory());
        `,
        "tests/dep.ts": `export const where = "beside the test file";`,
        "tests/shim.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as ofPreload from "../setup/dep";
          import * as ofTestFile from "./dep";
          test("vi.mock() of the preload script mocks the file beside the test file", () => {
            vi.mock("./dep", () => ({ where: "mock" }));
            expect([ofPreload.where, ofTestFile.where]).toEqual(["beside the preload script", "mock"]);
          });
        `,
      },
      1,
      ["--preload", "./setup/preload.ts"],
    );
  });

  test.concurrent("resolves a package name from the package of the helper, as with a block body", async () => {
    const packageOf = (name: string, where: string) => ({
      [`${where}/package.json`]: JSON.stringify({ name, type: "module", main: "./index.js" }),
    });
    await expectFixturesToPass(
      {
        ...packageOf("a-package", "node_modules/a-package"),
        "node_modules/a-package/index.js": `export const where = "of the test file";`,
        ...packageOf("test-helpers", "node_modules/test-helpers"),
        "node_modules/test-helpers/index.js": `
          import { mock } from "bun:test";
          export * as ofHelper from "a-package";
          export const mockPackage = () => mock.module("a-package", () => ({ where: "mock" }));
        `,
        ...packageOf("a-package", "node_modules/test-helpers/node_modules/a-package"),
        "node_modules/test-helpers/node_modules/a-package/index.js": `export const where = "of the helper";`,
        "package.test.ts": `
          import { expect, test } from "bun:test";
          import * as ofTestFile from "a-package";
          import { mockPackage, ofHelper } from "test-helpers";
          test("the helper mocks the package that it imports itself", () => {
            mockPackage();
            expect([ofHelper.where, ofTestFile.where]).toEqual(["mock", "of the test file"]);
          });
        `,
      },
      1,
    );
  });

  // The module that made a mock is evaluated again for the next test file, because the mock ends with the test file.
  test.concurrent("counts the helper as the module that mocked, as with a block body", async () => {
    const helper = (name: string, body: string) => `
      import { mock } from "bun:test";
      globalThis.evaluations ??= { tail: 0, block: 0 };
      globalThis.evaluations.${name}++;
      export const mockDep = () => ${body};
    `;
    await expectFixturesToPass(
      {
        "helpers/dep.ts": `export const where = "real";`,
        "helpers/tail.ts": helper("tail", `mock.module("./dep", () => ({ where: "mock" }))`),
        "helpers/block.ts": helper("block", `{ mock.module("./dep", () => ({ where: "mock" })); }`),
        "first.test.ts": `
          import { test } from "bun:test";
          import { mockDep as tail } from "./helpers/tail";
          import { mockDep as block } from "./helpers/block";
          test("both helpers mock", () => {
            tail();
            block();
          });
        `,
        "second.test.ts": `
          import { expect, test } from "bun:test";
          import "./helpers/tail";
          import "./helpers/block";
          test("both helpers were evaluated as often", () => {
            expect(globalThis.evaluations).toEqual({ tail: 2, block: 2 });
          });
        `,
      },
      2,
      ["./first.test.ts", "./second.test.ts"],
    );
  });
});
