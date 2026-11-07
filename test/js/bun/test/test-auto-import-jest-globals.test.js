import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, readdirSync } from "node:fs";
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
    aroundEach: "function",
    aroundAll: "function",
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
    const notOfVitest = {
      jest: header.includes("{ jest }") ? "object" : "undefined",
      xit: "undefined",
      xtest: "undefined",
      xdescribe: "undefined",
    };
    expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toEqual(
      header.includes(`"vitest"`) ? { ...types, ...notOfVitest } : types,
    );
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

  test("a name the file declares itself shadows the global", async () => {
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

describe.concurrent("a name that a script puts on globalThis after the file is loaded", () => {
  const rowsOf = stdout =>
    stdout
      .split("\n")
      .filter(line => line.startsWith("row: "))
      .sort();

  test.each([
    ["beforeAll", []],
    ["beforeAll", ["--isolate"]],
    ["beforeAll", ["--isolate=modules"]],
    ["beforeAll", ["--parallel=2"]],
    ["beforeAll", ["--globals=vitest"]],
    ["beforeEach", []],
    ["beforeEach", ["--isolate"]],
  ])("in a %s() of a preload script: %j", async (hook, flags) => {
    const file = name => `
      import { test } from "bun:test";
      test("test", () => {
        console.log("row: ${name}", expect === own.expect, describe === own.describe, it === own.it);
      });
    `;
    using dir = tempDir("jest-globals-late", {
      "preload.ts": `
        import { ${hook} } from "bun:test";
        globalThis.own = { expect: () => {}, describe: () => {}, it: () => {} };
        ${hook}(() => void Object.assign(globalThis, own));
      `,
      "a.test.ts": file("a"),
      "b.test.ts": file("b"),
      "c.test.ts": file("c"),
    });
    // With --parallel the rows come on stderr.
    const { stdout, stderr, exitCode } = await run(String(dir), ["test", "--preload=./preload.ts", ...flags]);
    expect({ rows: rowsOf(stdout + stderr), exitCode }).toEqual({
      rows: ["row: a true true true", "row: b true true true", "row: c true true true"],
      exitCode: 0,
    });
  });

  test("in a preload script that another one reads", async () => {
    using dir = tempDir("jest-globals-late", {
      "first.ts": `globalThis.own = globalThis.expect = () => {};`,
      "second.ts": `
        import { beforeAll } from "bun:test";
        console.log("row: as it loads", expect === own);
        beforeAll(() => console.log("row: in its hook", expect === own));
      `,
      "a.test.ts": `test("test", () => {});`,
    });
    const { stdout, exitCode } = await run(String(dir), ["test", "--preload=./first.ts", "--preload=./second.ts"]);
    expect({ rows: rowsOf(stdout), exitCode }).toEqual({
      rows: ["row: as it loads true", "row: in its hook true"],
      exitCode: 0,
    });
  });

  // Each file gets a global of its own, so none sees what another one set.
  test("in the test file, in a module that it loads and in a hook of its own", async () => {
    using dir = tempDir("jest-globals-late", {
      "body.test.ts": `
        import { test } from "bun:test";
        test("test", () => {
          const own = (globalThis.expect = () => {});
          console.log("row: body", expect === own);
        });
      `,
      "top.test.ts": `
        import { test } from "bun:test";
        const own = (globalThis.expect = () => {});
        test("test", () => console.log("row: top", expect === own));
      `,
      "sets.ts": `globalThis.own = globalThis.expect = () => {};`,
      "module.test.ts": `
        import { test } from "bun:test";
        import "./sets";
        test("test", () => console.log("row: module", expect === own));
      `,
      "hook.test.ts": `
        import { beforeAll, test } from "bun:test";
        beforeAll(() => void (globalThis.own = globalThis.expect = () => {}));
        test("test", () => console.log("row: hook", expect === own));
      `,
      "reads.ts": `
        import { mock } from "bun:test";
        export const read = () => expect;
      `,
      "helper.test.ts": `
        import { test } from "bun:test";
        import { read } from "./reads";
        test("test", () => {
          const before = typeof read();
          const own = (globalThis.expect = () => {});
          console.log("row: helper", before, read() === own);
        });
      `,
      "reads-later.ts": `
        import { mock } from "bun:test";
        export const value = expect;
      `,
      "reads-later.cjs": `
        const { mock } = require("bun:test");
        module.exports = expect;
      `,
      "later.test.ts": `
        import { test } from "bun:test";
        test("test", async () => {
          const own = (globalThis.expect = () => {});
          console.log("row: later", (await import("./reads-later")).value === own, require("./reads-later.cjs") === own);
        });
      `,
      "commonjs.test.cjs": `
        const { test } = require("@jest/globals");
        test("test", () => {
          const own = (globalThis.expect = () => {});
          console.log("row: commonjs", expect === own);
        });
      `,
      "vitest.test.ts": `
        import { test } from "vitest";
        test("test", () => {
          const own = (globalThis.expect = () => {});
          console.log("row: vitest", expect === own);
        });
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["test", "--isolate"]);
    expect({ rows: rowsOf(stdout), exitCode }).toEqual({
      rows: [
        "row: body true",
        "row: commonjs true",
        "row: helper function true",
        "row: hook true",
        "row: later true true",
        "row: module true",
        "row: top true",
        "row: vitest true",
      ],
      exitCode: 0,
    });
  });

  // With --isolate the second file gets the module as it was transpiled for the first.
  test("for one of two files that load the same module: --isolate", async () => {
    const file = name => `
      import { test } from "bun:test";
      import { read } from "./reads";
      test("test", () => console.log("row: ${name}", read() === globalThis.own ? "own" : typeof read()));
    `;
    using dir = tempDir("jest-globals-late", {
      "preload.ts": `
        import { existsSync, writeFileSync } from "node:fs";
        if (!existsSync("./is-set")) {
          writeFileSync("./is-set", "");
          globalThis.own = globalThis.expect = () => {};
        }
      `,
      "reads.ts": `
        import { mock } from "bun:test";
        export const read = () => expect;
      `,
      "a.test.ts": file("a"),
      "b.test.ts": file("b"),
    });
    const { stdout, exitCode } = await run(String(dir), ["test", "--isolate", "--preload=./preload.ts"]);
    expect({ rows: rowsOf(stdout), exitCode }).toEqual({ rows: ["row: a own", "row: b function"], exitCode: 0 });
  });

  test("in a hook that the React Compiler compiles", async () => {
    using dir = tempDir("jest-globals-late", {
      "node_modules/react/package.json": JSON.stringify({
        name: "react",
        version: "19.0.0",
        exports: { ".": "./index.js", "./compiler-runtime": "./compiler-runtime.js" },
      }),
      "node_modules/react/index.js": `export const useState = value => [value, () => {}];`,
      "node_modules/react/compiler-runtime.js": `export const c = size => Array(size).fill(Symbol.for("react.memo_cache_sentinel"));`,
      "useRunner.ts": `
        import { mock } from "bun:test";
        import { useState } from "react";
        export function useRunner(own: unknown) {
          const [factor] = useState(2);
          const seen = { isOwn: expect === own, describe: typeof describe, factor };
          return seen;
        }
      `,
      "hook.test.ts": `
        import { test } from "bun:test";
        import { useRunner } from "./useRunner";
        test("test", () => {
          const before = useRunner(null);
          const own = (globalThis.expect = () => {});
          const isCompiled = /\\$\\[\\d+\\]/.test(String(useRunner));
          console.log("row: hook", isCompiled, JSON.stringify([before, useRunner(own)]));
        });
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["test", "--react-compiler"]);
    const seen = { describe: "function", factor: 2 };
    expect({ rows: rowsOf(stdout), exitCode }).toEqual({
      rows: [
        `row: hook true ${JSON.stringify([
          { isOwn: false, ...seen },
          { isOwn: true, ...seen },
        ])}`,
      ],
      exitCode: 0,
    });
  });

  test("undefined and null count as not set, and a store goes to globalThis", async () => {
    using dir = tempDir("jest-globals-late", {
      "presence.test.ts": `
        import { test } from "bun:test";
        import * as runner from "bun:test";
        test("test", () => {
          const own = () => {};
          const second = () => {};
          const which = () =>
            expect === own ? "own" : expect === second ? "second" : expect === runner.expect ? "runner" : String(expect);
          const rows = [which()];
          globalThis.expect = own;
          rows.push(which());
          expect = second;
          rows.push(which(), globalThis.expect === second);
          globalThis.expect = undefined;
          rows.push(which());
          globalThis.expect = null;
          rows.push(which());
          globalThis.expect = own;
          delete globalThis.expect;
          rows.push(which(), typeof expect, { expect }.expect === runner.expect);
          console.log("row: presence", rows.join(" "));
        });
      `,
      "sloppy.test.cjs": `
        const { test } = require("bun:test");
        test("test", () => {
          const own = () => {};
          expect = own;
          console.log("row: sloppy", expect === own, globalThis.expect === own);
          delete globalThis.expect;
        });
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["test"]);
    expect({ rows: rowsOf(stdout), exitCode }).toEqual({
      rows: ["row: presence runner own second true runner runner runner function true", "row: sloppy true true"],
      exitCode: 0,
    });
  });

  test("with --globals=vitest the name is a property of globalThis and nothing else", async () => {
    using dir = tempDir("jest-globals-late", {
      "globals.test.ts": `
        import { test } from "vitest";
        import * as runner from "vitest";
        test("test", () => {
          const own = () => {};
          const rows = [expect === runner.expect];
          globalThis.expect = own;
          rows.push(expect === own);
          globalThis.expect = undefined;
          rows.push(String(expect));
          delete globalThis.expect;
          rows.push(typeof expect);
          try {
            rows.push(String(expect));
          } catch (error) {
            rows.push(error.name);
          }
          console.log("row: globals", rows.join(" "));
        });
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["test", "--globals=vitest"]);
    expect({ rows: rowsOf(stdout), exitCode }).toEqual({
      rows: ["row: globals true true undefined undefined ReferenceError"],
      exitCode: 0,
    });
  });
});

test.concurrent("jest still works as a global when a decorated member's type mentions it", async () => {
  using dir = tempDir("jest-globals-decorator-metadata", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }),
    "metadata.test.ts": `
      const types: unknown[] = [];
      (Reflect as any).metadata = (key: string, type: unknown) => () => {
        if (key === "design:type") types.push(type);
      };
      function decorated(target: unknown, key: string) {}
      class Service {}
      class Holder {
        @decorated service: jest.Mocked<Service>;
      }
      test("test", () => {
        const fn = jest.fn();
        fn();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(types).toEqual([Object]);
      });
    `,
  });
  const { stderr, exitCode } = await run(String(dir), ["test", "metadata.test.ts"]);
  expect(stderr).toContain(" 1 pass\n 0 fail\n");
  expect(exitCode).toBe(0);
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
  ])("caches a test file: %s", async header => {
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

  test("uses separate entries for `bun test` and `bun run`", async () => {
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

  test("keeps the entry with and without a preload that sets globalThis.expect, but not with --globals=vitest", async () => {
    using dir = tempDir("jest-globals-cache", {
      "preload.ts": `globalThis.expect = () => "own";`,
      "cached.test.ts": `
        import { test } from "bun:test";
        test("test", () => console.log(typeof expect(1)));
        ${padding}
      `,
    });
    const cache = join(String(dir), "cache");
    const results = [];
    let before = "";
    for (const flags of [
      [],
      ["--preload=./preload.ts"],
      [],
      ["--preload=./preload.ts"],
      ["--globals=vitest"],
      ["--globals=vitest", "--preload=./preload.ts"],
    ]) {
      const { stdout, exitCode } = await run(String(dir), ["test", ...flags, "cached.test.ts"], cacheEnv(String(dir)));
      // A file is written again when its entry is for other features.
      const after = readdirSync(cache)
        .map(name => `${name} ${Bun.hash(readFileSync(join(cache, name)))}`)
        .join();
      results.push({ stdout: stdout.trim().split("\n").at(-1), isWritten: after !== before, exitCode });
      before = after;
    }
    expect(results).toEqual([
      { stdout: "object", isWritten: true, exitCode: 0 },
      { stdout: "string", isWritten: false, exitCode: 0 },
      { stdout: "object", isWritten: false, exitCode: 0 },
      { stdout: "string", isWritten: false, exitCode: 0 },
      { stdout: "object", isWritten: true, exitCode: 0 },
      { stdout: "string", isWritten: false, exitCode: 0 },
    ]);
  });
});
