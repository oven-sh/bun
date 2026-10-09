import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

test("Jest auto imports", () => {
  expect(true).toBe(true);
  expect(typeof describe).toBe("function");
  expect(typeof it).toBe("function");
  expect(typeof test).toBe("function");
  expect(typeof expect).toBe("function");
  expect(typeof beforeAll).toBe("function");
  expect(typeof beforeEach).toBe("function");
  expect(typeof afterAll).toBe("function");
  expect(typeof afterEach).toBe("function");
});

test("Jest's globals aren't available in every file", async () => {
  const jestGlobals = await import("./jest-doesnt-auto-import.js");

  expect(typeof jestGlobals.describe).toBe("undefined");
  expect(typeof jestGlobals.it).toBe("undefined");
  expect(typeof jestGlobals.test).toBe("undefined");
  expect(typeof jestGlobals.expect).toBe("undefined");
  expect(typeof jestGlobals.beforeAll).toBe("undefined");
  expect(typeof jestGlobals.beforeEach).toBe("undefined");
  expect(typeof jestGlobals.afterAll).toBe("undefined");
  expect(typeof jestGlobals.afterEach).toBe("undefined");
});

async function run(cwd, args, env = bunEnv) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("a file that imports from a test module", () => {
  const types = {
    test: "function",
    it: "function",
    describe: "function",
    expect: "function",
    expectTypeOf: "function",
    beforeAll: "function",
    beforeEach: "function",
    afterEach: "function",
    afterAll: "function",
    jest: "object",
    vi: "object",
    xit: "function",
    xtest: "function",
    xdescribe: "function",
    onTestFinished: "function",
  };

  test.each([
    ["globals.test.ts", `import { vi } from "vitest";`],
    ["globals.test.ts", `import { jest } from "@jest/globals";`],
    ["globals.test.ts", `import { mock } from "bun:test";`],
    [
      "globals.test.ts",
      `import { vi } from "vitest"; import { jest } from "@jest/globals"; import { mock } from "bun:test";`,
    ],
    ["globals.test.ts", `import * as all from "vitest";`],
    ["globals.test.ts", `import "bun:test";`],
    ["globals.test.ts", `export { mock } from "bun:test";`],
    ["globals.test.ts", `await import("vitest");`],
    ["globals.test.ts", `const { mock } = require("bun:test");`],
    ["globals.test.cjs", `const { mock } = require("bun:test");`],
    ["globals.test.cjs", `const { vi } = require("bun:test");`],
    ["globals.test.ts", ``],
    ["globals.test.cjs", ``],
  ])("%s: %s keeps the other globals", async (name, header) => {
    using dir = tempDir("jest-globals", {
      [name]: `
        ${header}
        console.log(JSON.stringify({ ${Object.keys(types)
          .map(name => `${name}: typeof ${name}`)
          .join(", ")} }));
        describe("describe", () => {
          it("it", () => {
            expect(1).toBe(1);
          });
        });
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test", name]);
    expect(stderr).toContain(" 1 pass");
    expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toEqual(types);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["vitest", "globals.test.ts", `import { vi } from "vitest";`],
    ["vitest", "globals.test.ts", `import { Mock } from "vitest"; let mock: Mock;`],
    ["vitest", "globals.test.ts", `await import("vitest");`],
    ["bun", "globals.test.ts", `vi.fn();`],
    [
      "vitest",
      "globals.test.ts",
      `import { jest } from "@jest/globals"; import { mock } from "bun:test"; import { vi } from "vitest";`,
    ],
    ["bun", "globals.test.ts", `import { jest } from "@jest/globals";`],
    ["bun", "globals.test.ts", `import { vi } from "bun:test";`],
    ["bun", "globals.test.ts", `jest.fn();`],
    ["bun", "globals.test.ts", ``],
    ["bun", "globals.test.cjs", `vi.fn();`],
    ["vitest", "globals.test.cjs", `require("vitest");`],
    ["bun", "globals.test.cjs", `jest.fn();`],
    ["bun", "globals.test.cjs", ``],
  ])("the globals are the exports of %s in %s: %s", async (module, name, header) => {
    using dir = tempDir("jest-globals", {
      "modules.ts": `
        import * as vitest from "vitest";
        import * as bun from "bun:test";
        export { vitest, bun };
      `,
      [name]: `
        ${header}
        ${name.endsWith(".cjs") ? `const modules = require("./modules.ts");` : `import * as modules from "./modules";`}
        const expected = modules.${module};
        console.log(JSON.stringify([
          test === expected.test, it === expected.it, describe === expected.describe, expect === expected.expect,
          beforeAll === expected.beforeAll, beforeEach === expected.beforeEach,
          afterEach === expected.afterEach, afterAll === expected.afterAll,
        ]));
        test("test", () => {});
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test", name]);
    expect(stderr).toContain(" 1 pass");
    expect(JSON.parse(stdout.slice(stdout.indexOf("[")))).toEqual([true, true, true, true, true, true, true, true]);
    expect(exitCode).toBe(0);
  });

  test("a name that the file binds is not a global", async () => {
    using dir = tempDir("jest-globals", {
      "globals.test.ts": `
        import { describe as it, test as renamed } from "vitest";
        import * as jest from "./other";
        const expect = () => "const";
        function beforeAll() { return "function"; }
        { var afterAll = "var"; }
        class beforeEach {}
        enum afterEach { member = "enum" }
        const parameter = (vi: string) => vi;
        console.log(JSON.stringify([
          it === describe, renamed === test, jest.other, expect(), beforeAll(), afterAll, beforeEach.name, afterEach.member,
          parameter("parameter"), typeof vi,
        ]));
        test("test", () => {});
      `,
      "other.ts": `export const other = "namespace";`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test", "globals.test.ts"]);
    expect(stderr).toContain(" 1 pass");
    expect(JSON.parse(stdout.slice(stdout.indexOf("[")))).toEqual([
      true,
      true,
      "namespace",
      "const",
      "function",
      "var",
      "beforeEach",
      "enum",
      "parameter",
      "object",
    ]);
    expect(exitCode).toBe(0);
  });

  test.each(["--no-isolate", "--isolate"])(
    "a name that a preload script has put on globalThis is not replaced: %s",
    async flag => {
      const own = `
        describe("own", () => {
          test("test", () => expect(1).to.equal(1));
        });
        it("the other globals", () => {});
      `;
      using dir = tempDir("jest-globals", {
        "preload.ts": `
          globalThis.expect = value => ({ to: { equal: other => console.log("own expect", value === other) } });
          globalThis.describe = (name, fn) => (console.log("own describe"), fn());
        `,
        "a.test.ts": `import { test } from "bun:test"; ${own}`,
        "b.test.cjs": `const { test } = require("@jest/globals"); ${own}`,
        "c.test.ts": `import { test } from "vitest"; ${own}`,
        "d-imports-nothing.test.ts": `
          describe("builtin", () => {
            test("test", () => expect(1).toBe(1));
          });
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["test", "--preload=./preload.ts", flag]);
      expect({
        stdout: stdout.split("\n").filter(line => line.startsWith("own")),
        results: stderr.match(/^\((pass|fail)\) [a-z >]+[a-z]/gm),
        exitCode,
      }).toEqual({
        stdout: [
          "own describe",
          "own expect true",
          "own describe",
          "own expect true",
          "own describe",
          "own expect true",
        ],
        results: [
          "(pass) test",
          "(pass) the other globals",
          "(pass) test",
          "(pass) the other globals",
          "(pass) test",
          "(pass) the other globals",
          "(pass) builtin > test",
        ],
        exitCode: 0,
      });
    },
  );
});

describe.concurrent("the transpiler cache", () => {
  const padding = `// ${Buffer.alloc(8192, "x").toString()}`;
  const cacheEnv = dir => ({
    ...bunEnv,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(dir, "cache"),
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  });

  test.each([
    [`import { vi } from "vitest";`],
    [`import { jest } from "@jest/globals";`],
    [`import { mock } from "bun:test";`],
    [``],
  ])("holds a test file: %s", async header => {
    using dir = tempDir("jest-globals-cache", {
      "cached.test.ts": `
        ${header}
        test("test", () => {
          expect(typeof vi.fn).toBe("function");
        });
        ${padding}
      `,
    });
    const results = [];
    for (const flags of [[], [], ["--isolate"], ["--isolate"]]) {
      const { exitCode } = await run(String(dir), ["test", ...flags, "cached.test.ts"], cacheEnv(String(dir)));
      results.push({ exitCode, entries: readdirSync(join(String(dir), "cache")).length });
    }
    expect(results).toEqual([
      { exitCode: 0, entries: 1 },
      { exitCode: 0, entries: 1 },
      { exitCode: 0, entries: 1 },
      { exitCode: 0, entries: 1 },
    ]);
  });

  test("keeps `bun test` and `bun run` apart", async () => {
    using dir = tempDir("jest-globals-cache", {
      "node_modules/vitest/package.json": `{ "name": "vitest", "main": "index.js" }`,
      "node_modules/vitest/index.js": `exports.vi = { fn: "the package" };`,
      "shared.ts": `
        import { vi } from "vitest";
        console.log(typeof vi.fn, typeof expect);
        ${padding}
      `,
      "shared.test.ts": `
        import "./shared";
        test("test", () => {});
      `,
    });
    const results = [];
    for (const args of [["shared.ts"], ["test", "shared.test.ts"], ["shared.ts"], ["test", "shared.test.ts"]]) {
      const { stdout, exitCode } = await run(String(dir), args, cacheEnv(String(dir)));
      results.push({ stdout: stdout.trim().split("\n").at(-1), exitCode });
    }
    expect(results).toEqual([
      { stdout: "string undefined", exitCode: 0 },
      { stdout: "function function", exitCode: 0 },
      { stdout: "string undefined", exitCode: 0 },
      { stdout: "function function", exitCode: 0 },
    ]);
  });

  test("keeps apart what a file is with and without a global of a preload script", async () => {
    using dir = tempDir("jest-globals-cache", {
      "preload.ts": `globalThis.expect = () => "own";`,
      "cached.test.ts": `
        import { test } from "bun:test";
        test("test", () => console.log(typeof expect(1)));
        ${padding}
      `,
    });
    const results = [];
    for (const flags of [[], ["--preload=./preload.ts"], [], ["--preload=./preload.ts"]]) {
      const { stdout, exitCode } = await run(String(dir), ["test", ...flags, "cached.test.ts"], cacheEnv(String(dir)));
      results.push({ stdout: stdout.trim().split("\n").at(-1), exitCode });
    }
    expect(results).toEqual([
      { stdout: "object", exitCode: 0 },
      { stdout: "string", exitCode: 0 },
      { stdout: "object", exitCode: 0 },
      { stdout: "string", exitCode: 0 },
    ]);
  });
});
