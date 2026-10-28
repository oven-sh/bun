import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run } from "../../aot/harness/run";
import { unsupported } from "../../aot/run-programs";

const supported = !unsupported;

function expectToHaveUsedImage(stderr: string) {
  expect(stderr).toContain("[aot] image: ");
  return stderr.replace(/^\[aot\] .*\r?\n/gm, "");
}

const theReportOfAThrownErrorNamesTheSameLineAndAnotherColumnUnderAot =
  /^ +\^\n(error: thrown in a test\n +at <anonymous> \(<dir>[\\/]a\.test\.ts:\d+):\d+\)/m;

async function runTests(cwd: string, aot: boolean, args: string[] = [], builds = true) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...(aot ? ["--debug-aot"] : []), ...args], cwd, {
    ...bunEnv,
    ...(aot ? { BUN_AOT_VERBOSE: "1" } : {}),
  });
  return {
    stdout: stdout.replaceAll(cwd, "<dir>"),
    stderr: (aot && builds ? expectToHaveUsedImage(stderr) : stderr)
      .replaceAll(cwd, "<dir>")
      .replace(/ \[\d+(\.\d+)?m?s\]/g, "")
      .replace(theReportOfAThrownErrorNamesTheSameLineAndAnotherColumnUnderAot, "$1:<column>)"),
    exitCode,
  };
}

const theWarningThatAFileIsCompiledUntyped =
  /^warn: TS100010: '<dir>\/([^']+)' has \d+ type errors? \([^\n]*\), so it is compiled without its types\.[^\n]*\n\n(?:[^\n]*\n)*?   at <dir>\/[^\n]*\n/gm;

async function expectSameAsBunTest(
  files: Record<string, string>,
  args?: string[],
  builds = true,
  compiledUntyped: string[] = [],
) {
  using expectedDir = tempDir("test-aot", files);
  using actualDir = tempDir("test-aot", files);
  const [expected, actual] = await Promise.all([
    runTests(String(expectedDir), false, args),
    runTests(String(actualDir), true, args, builds),
  ]);
  const warnedOf: string[] = [];
  actual.stderr = actual.stderr.replace(
    theWarningThatAFileIsCompiledUntyped,
    (_warning, file) => (warnedOf.push(file), ""),
  );
  expect(warnedOf).toEqual(compiledUntyped);
  expect(actual).toEqual(expected);
  return actual;
}

describe.skipIf(!supported)("bun test --aot", () => {
  test.concurrent("passes, failures, skips, todos and hooks in several files", async () => {
    const { stderr, exitCode } = await expectSameAsBunTest({
      "a.test.ts": `
        import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
        import { fib } from "./sub/fib";
        let ready = 0;
        beforeAll(() => { ready = 1; });
        beforeEach(() => { ready++; });
        afterAll(() => { console.log("afterAll", ready); });
        describe("a", () => {
          test("passes", () => { expect(ready).toBe(2); expect(fib(20)).toBe(6765); });
          test("fails", () => { expect(fib(3)).toBe(100); });
          test("throws", () => { throw new Error("thrown in a test"); });
          test("async", async () => { expect(await Promise.resolve(fib(10))).toBe(55); });
          test.each([[1, 1], [2, 1], [3, 2]])("fib(%i) is %i", (n, expected) => { expect(fib(n)).toBe(expected); });
          test.skip("skipped", () => {});
          test.todo("todo");
        });
      `,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { fib } from "./sub/fib";
        test("in another file", () => { expect(fib(5)).toBe(5); });
      `,
      "sub/fib.ts": `export function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }`,
    });
    expect(stderr).toContain(" 6 pass");
    expect(stderr).toContain(" 2 fail");
    expect(exitCode).toBe(1);
  });

  test.concurrent("test globals work without an import", async () => {
    const { stderr } = await expectSameAsBunTest({
      "globals.test.js": `
        describe("globals", () => {
          beforeAll(() => {});
          it("has them", () => { expect(typeof test).toBe("function"); });
        });
      `,
      "jest.test.ts": `
        import { expect, test } from "@jest/globals";
        test("from @jest/globals", () => { expect(1).toBe(1); });
      `,
    });
    expect(stderr).toContain(" 2 pass");
  });

  test.concurrent("a test file sees the path of its source file", async () => {
    const { stderr } = await expectSameAsBunTest({
      "sub/paths.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync } from "node:fs";
        test("paths", async () => {
          expect(import.meta.path.split(/[\\\\/]/).slice(-2)).toEqual(["sub", "paths.test.ts"]);
          expect(Bun.main).toBe(import.meta.path);
          expect(import.meta.main).toBe(true);
          expect({ ...import.meta }.dir ?? import.meta.dir).toBe(import.meta.dir);
          expect(readFileSync(import.meta.dir + "/fixture.txt", "utf8")).toBe("the fixture");
          const late = "./late" + "";
          expect((await import(late)).default).toBe("found when it ran");
        });
      `,
      "sub/fixture.txt": `the fixture`,
      "sub/late.ts": `export default "found when it ran";`,
    });
    expect(stderr).toContain(" 1 pass");
  });

  test.concurrent("a dependency with top-level await that is imported statically and dynamically", async () => {
    const { stderr, exitCode } = await expectSameAsBunTest({
      "both.test.ts": `
        import { expect, test } from "bun:test";
        import { value } from "./dep";
        test("static", () => { expect(value).toBe(1); });
        test("dynamic", async () => { const { other } = await import("./dep"); expect(other()).toBe(2); });
      `,
      "dep.ts": `
        import { late } from "./tla";
        export const value = late;
        export function other() { return 2; }
      `,
      "tla.ts": `export const late = await Promise.resolve(1);`,
    });
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a test file with top-level await that its own dependency imports", async () => {
    const { stderr, exitCode } = await expectSameAsBunTest({
      "self.test.ts": `
        import { expect, test } from "bun:test";
        import { again } from "./back";
        export const marker = "self";
        const value = await Promise.resolve(1);
        test("registered after the await", async () => {
          expect(value).toBe(1);
          expect((await again()).marker).toBe("self");
        });
      `,
      "back.ts": `export const again = () => import("./self.test");`,
    });
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("snapshots", async () => {
    const files = {
      "snap.test.ts": `
        import { expect, test } from "bun:test";
        test("snapshot", () => { expect({ a: 1, b: [2, 3] }).toMatchSnapshot(); });
        test("inline snapshot", () => { expect({ c: 4 }).toMatchInlineSnapshot(); });
      `,
    };
    using expectedDir = tempDir("test-aot", files);
    using actualDir = tempDir("test-aot", files);
    const [expected, actual] = await Promise.all([
      runTests(String(expectedDir), false, ["--update-snapshots"]),
      runTests(String(actualDir), true, ["--update-snapshots"]),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.exitCode).toBe(0);
    for (const file of [join("__snapshots__", "snap.test.ts.snap"), "snap.test.ts"])
      expect(readFileSync(join(String(actualDir), file), "utf8")).toBe(
        readFileSync(join(String(expectedDir), file), "utf8"),
      );
    expect(readFileSync(join(String(actualDir), "snap.test.ts"), "utf8")).toContain(`"c": 4`);
  });

  test.concurrent("functions with inferred names are printed, mocked and snapshotted as without --aot", async () => {
    const files = {
      "names.test.ts": `
        import { expect, mock, test } from "bun:test";
        const element = (type: unknown) => ({ $$typeof: Symbol.for("react.element"), type, key: null, ref: null, props: {} });
        const Arrow = () => null;
        function Declared() { return null; }
        const Expression = function () { return null; };
        const Named = function Own() { return null; };
        const AnonymousClass = class { m() {} };
        class DeclaredClass { m() {} }
        const held = { Method() { return null; }, Property: () => null };
        const all = [Arrow, Declared, Expression, Named, AnonymousClass, DeclaredClass, held.Method, held.Property];
        test("the name property", () => { expect(all.map(f => f.name)).toEqual(["Arrow", "Declared", "Expression", "Own", "AnonymousClass", "DeclaredClass", "Method", "Property"]); });
        test("mocks", () => { console.log(all.map(f => mock(f as () => unknown)).map(m => JSON.stringify([m.name, m.getMockName()])).join(" ")); });
        test("a failure's text", () => { expect([...all, ...all.map(element)]).toEqual([]); });
        test("a snapshot", () => { expect({ all, elements: all.map(element) }).toMatchSnapshot(); });
      `,
    };
    using expectedDir = tempDir("test-aot", files);
    using actualDir = tempDir("test-aot", files);
    const [expected, actual] = await Promise.all([
      runTests(String(expectedDir), false, ["--update-snapshots"]),
      runTests(String(actualDir), true, ["--update-snapshots"]),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.stderr).toContain(" 3 pass");
    const snapshot = join("__snapshots__", "names.test.ts.snap");
    expect(readFileSync(join(String(actualDir), snapshot), "utf8")).toBe(
      readFileSync(join(String(expectedDir), snapshot), "utf8"),
    );
  });

  test.concurrent("other options work the same as without --aot", async () => {
    const { stderr } = await expectSameAsBunTest(
      {
        "a.test.ts": `
          import { expect, test } from "bun:test";
          test("wanted", () => { expect((globalThis as any).preloaded).toBe(true); });
          test("other", () => { expect(1).toBe(2); });
        `,
        "b.test.ts": `
          import { expect, test } from "bun:test";
          test("wanted, but in a file that is not", () => { expect(1).toBe(2); });
        `,
        "preload.ts": `(globalThis as any).preloaded = true;`,
      },
      ["--preload=./preload.ts", "-t", "wanted", "a.test.ts"],
    );
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
  });

  test.concurrent.each([[["--cwd=app"]], [["--cwd", "app"]]])("a relative %j is applied once", async flags => {
    const file = (path: string) =>
      `import { test } from "bun:test";\ntest("runs", () => { console.log("${path}", process.cwd()); });`;
    const { stdout, stderr, exitCode } = await expectSameAsBunTest(
      { "app/a.test.ts": file("app/a.test.ts"), "app/app/a.test.ts": file("app/app/a.test.ts") },
      [...flags, "./a.test.ts"],
    );
    expect(stdout).toMatch(/^app\/a\.test\.ts <dir>[\\/]app$/m);
    expect(stdout).not.toContain("app/app/a.test.ts");
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a preload governed by a different tsconfig.json than the test", async () => {
    const options = `"strict": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "types": ["bun"], "skipLibCheck": true`;
    const files = {
      "tsconfig.json": `{ "compilerOptions": { ${options}, "experimentalDecorators": true, "emitDecoratorMetadata": true } }`,
      "bunfig.toml": `[test]\npreload = ["./preload.ts"]\n`,
      "preload.ts": `import { helper } from "./helper";\n(globalThis as any).preloaded = helper("pre");`,
      "helper.ts": `export const helper = (text: string) => text + "loaded";`,
      "decorated.ts": `
        function mark<T extends new (...args: any[]) => object>(target: T) { return target; }
        @mark
        export class Marked { x = 1; }
      `,
      "sub/tsconfig.json": `{ "compilerOptions": { ${options} } }`,
      "sub/a.test.ts": `
        import { expect, test } from "bun:test";
        test("the preload ran", () => { expect((globalThis as any).preloaded).toBe("preloaded"); });
      `,
      "sub/b.test.ts": `
        import { expect, test } from "bun:test";
        import { Marked } from "../decorated";
        test("decorated", () => { expect(new Marked().x).toBe(1); });
      `,
    };
    const { stderr } = await expectSameAsBunTest(files, ["./sub/a.test.ts"]);
    expect(stderr).toContain(" 1 pass");
    const decorated = await expectSameAsBunTest(files, ["./sub/b.test.ts"]);
    expect(decorated.stderr).toContain(" 1 pass");
  });

  test.concurrent("a preload that type checks only under its own tsconfig.json", async () => {
    const options = `"target": "esnext", "module": "esnext", "moduleResolution": "bundler", "types": ["bun"], "skipLibCheck": true`;
    const { stderr } = await expectSameAsBunTest(
      {
        "tsconfig.json": `{ "compilerOptions": { ${options}, "strict": false, "paths": { "@util/*": ["./util/*"] } } }`,
        "bunfig.toml": `[test]\npreload = ["./preload.ts"]\n`,
        "preload.ts": `
          import { helper } from "@util/helper";
          function loose(chunk) { return chunk; }
          (globalThis as any).preloaded = loose(helper("pre"));
        `,
        "util/helper.ts": `export const helper = (text: string) => text + "loaded";`,
        "sub/tsconfig.json": `{ "compilerOptions": { ${options}, "strict": true } }`,
        "sub/a.test.ts": `
          import { expect, test } from "bun:test";
          test("the preload ran", () => { expect((globalThis as any).preloaded).toBe("preloaded"); });
        `,
      },
      ["./sub/a.test.ts"],
    );
    expect(stderr).toContain(" 1 pass");
  });

  test.concurrent.each([["--watch"], ["--hot"], ["--rerun-each", "2"]])("%s is not supported", async (...flags) => {
    using dir = tempDir("test-aot", {
      "a.test.ts": `import { expect, test } from "bun:test";\ntest("runs", () => { expect(1).toBe(1); });`,
    });
    const { stdout, stderr, exitCode } = await runTests(
      String(dir),
      true,
      [...[...flags].filter((flag): flag is string => typeof flag === "string"), "a.test.ts"],
      false,
    );
    expect(stdout.replace(/^bun test .*\n/, "")).toBe("");
    expect(stderr).toContain(`error: --aot does not support ${flags[0]}`);
    expect(stderr).not.toContain(" pass");
    expect(exitCode).toBe(1);
  });

  test.concurrent("rerunEach in bunfig.toml is not supported", async () => {
    using dir = tempDir("test-aot", {
      "bunfig.toml": `[test]\nrerunEach = 2\n`,
      "a.test.ts": `import { expect, test } from "bun:test";\ntest("runs", () => { expect(1).toBe(1); });`,
    });
    const { stderr, exitCode } = await runTests(String(dir), true, ["a.test.ts"], false);
    expect(stderr).toContain(`error: --aot does not support --rerun-each (or "rerunEach" in bunfig.toml): `);
    expect(exitCode).toBe(1);
  });

  test.concurrent.each([
    ["throws", `console.log("the preload begins"); throw new Error("thrown by the preload");`],
    ["says test()", `import { test } from "bun:test"; test("in a preload", () => {});`],
  ])("a preload that %s is reported", async (_what, preload) => {
    const { stderr, exitCode } = await expectSameAsBunTest(
      {
        "preload.ts": preload,
        "a.test.ts": `import { test } from "bun:test"; test("runs", () => {});`,
      },
      ["--preload", "./preload.ts", "./a.test.ts"],
    );
    expect(stderr).toContain("error: ");
    expect(exitCode).toBe(1);
  });

  test.concurrent("test files with the same name and different extensions", async () => {
    const file = (name: string) =>
      `import { test } from "bun:test"; test("in ${name}", () => { console.log("ran ${name}"); });`;
    const { stderr } = await expectSameAsBunTest(
      Object.fromEntries(
        ["a.test.js", "a.test.mjs", "a.test.ts", "a.test.tsx", "sub/a.test.ts"].map(name => [name, file(name)]),
      ),
    );
    expect(stderr).toContain(" 5 pass");
  });

  test.concurrent("a module with top-level await that a preload also imports is instantiated once", async () => {
    const { stdout, stderr } = await expectSameAsBunTest(
      {
        "a.test.ts": `
          import { expect, test } from "bun:test";
          import { state } from "./lib";
          test("sees what the preload did", () => {
            console.log(state.seen.join(", "));
            expect((globalThis as any).ofThePreload).toBe(state);
          });
        `,
        "lib.ts": `
          console.log("lib is evaluated");
          await Promise.resolve();
          export const state: { seen: string[] } = { seen: [] };
        `,
        "preload.ts": `
          import { state } from "./lib";
          state.seen.push("the preload");
          (globalThis as any).ofThePreload = state;
        `,
      },
      ["--preload", "./preload.ts", "./a.test.ts"],
    );
    expect(stdout.match(/lib is evaluated/g)).toHaveLength(1);
    expect(stderr).toContain(" 1 pass");
  });

  test.concurrent("spyOn works on the program's own objects and classes", async () => {
    const { stderr, exitCode } = await expectSameAsBunTest({
      "methods.test.ts": `
        import { expect, spyOn, test } from "bun:test";
        class Client {
          sent = 0;
          request(path: string): string { this.sent++; return "GET " + path; }
        }
        class Other { run(): string { return "ran"; } }
        interface Service { handle: (n: number) => number; calls: number }
        test("through an instance", () => {
          const client = new Client();
          const spy = spyOn(client, "request").mockReturnValue("mocked");
          expect(client.request("/")).toBe("mocked");
          expect(spy).toHaveBeenCalledWith("/");
          expect(client.sent).toBe(0);
          spy.mockRestore();
          expect(client.request("/")).toBe("GET /");
          expect(client.sent).toBe(1);
          expect(new Client().request("/other")).toBe("GET /other");
        });
        test("through the prototype", () => {
          const spy = spyOn(Client.prototype, "request").mockReturnValue("mocked");
          expect(new Client().request("/")).toBe("mocked");
          spy.mockRestore();
          expect(new Client().request("/")).toBe("GET /");
        });
        test("by a computed name", () => {
          const other = new Other();
          const spy = spyOn(other, ["r", "un"].join("") as any).mockReturnValue("mocked");
          expect(other.run()).toBe("mocked");
          expect(spy).toHaveBeenCalledTimes(1);
          spy.mockRestore();
          expect(other.run()).toBe("ran");
        });
        test("a property that holds a function", () => {
          const service: Service = { handle: n => n + 1, calls: 0 };
          const spy = spyOn(service, "handle").mockImplementation((n: number) => n + 100);
          expect(service.handle(1)).toBe(101);
          expect(spy).toHaveBeenCalledTimes(1);
          spy.mockRestore();
          expect(service.handle(1)).toBe(2);
          expect(Object.keys(service)).toEqual(["handle", "calls"]);
        });
        test("a property that holds no function", () => {
          const service: Service = { handle: n => n + 1, calls: 0 };
          const reads = spyOn(service, "calls");
          expect(service.calls).toBe(0);
          expect(reads).toHaveBeenCalledTimes(1);
          const client = new Client();
          const spy = spyOn(client, "sent");
          expect(client.request("/")).toBe("GET /");
          expect(spy).toHaveBeenCalled();
        });
      `,
    });
    expect(stderr).toContain(" 5 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a build error", async () => {
    using dir = tempDir("test-aot", { "bad.test.ts": `import "./does-not-exist";` });
    const { stderr, exitCode } = await runTests(String(dir), true, [], false);
    expect(stderr).toContain("./does-not-exist");
    expect(exitCode).toBe(1);
  });
});
