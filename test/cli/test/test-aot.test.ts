import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isWindows, tempDir } from "harness";
import { join } from "path";

// `bun test --aot`: compiles the test files ahead of time, as `bun build --compile --compile-aot` does, then replaces
// itself with the result. The compiler only targets arm64 so far.
const supported = isArm64 && !isWindows;

// A run that did not use its compiled code would still work, from the bytecode, and nothing else here would notice. So
// each run logs what it uses, which is checked and then removed from the output.
function expectToHaveUsedImage(stderr: string) {
  expect(stderr).toContain("[aot] program data: ");
  expect(stderr).toContain("[aot] image: ");
  expect(stderr).not.toContain("[aot] not using");
  return stderr.replace(/^\[aot\] .*\n/gm, "");
}

async function runTests(cwd: string, aot: boolean, args: string[] = [], builds = true) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...(aot ? ["--aot"] : []), ...args],
    env: { ...bunEnv, ...(aot ? { BUN_AOT_VERBOSE: "1" } : {}) },
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: stdout.replaceAll(cwd, "<dir>"),
    // Remove durations, which are only printed for slow tests.
    stderr: (aot && builds ? expectToHaveUsedImage(stderr) : stderr)
      .replaceAll(cwd, "<dir>")
      .replace(/ \[\d+(\.\d+)?m?s\]/g, ""),
    exitCode,
  };
}

// `bun test` provides the expected output. Each run gets its own directory, because tests may write snapshots.
async function expectSameAsBunTest(files: Record<string, string>, args?: string[], builds = true) {
  using expectedDir = tempDir("test-aot", files);
  using actualDir = tempDir("test-aot", files);
  const [expected, actual] = await Promise.all([
    runTests(String(expectedDir), false, args),
    runTests(String(actualDir), true, args, builds),
  ]);
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

  test.concurrent("the globals, without an import", async () => {
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
          expect(import.meta.path.endsWith("/sub/paths.test.ts")).toBe(true);
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

  // The bundler puts `await init_dep()` at the top of the file's chunk. If the runner did not wait for it, no test would be
  // registered, and the run would pass.
  test.concurrent("a dependency that is imported both ways and awaits at the top level", async () => {
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

  // The same, where the async initializer is the test file's own: the top level only contains `await init_self()`.
  test.concurrent("a test file that awaits at the top level and is imported by its dependency", async () => {
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
    // Both are written next to, and into, the source file.
    for (const file of [join("__snapshots__", "snap.test.ts.snap"), "snap.test.ts"])
      expect(readFileSync(join(String(actualDir), file), "utf8")).toBe(
        readFileSync(join(String(expectedDir), file), "utf8"),
      );
    expect(readFileSync(join(String(actualDir), "snap.test.ts"), "utf8")).toContain(`"c": 4`);
  });

  test.concurrent("other options mean what they mean without it", async () => {
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

  // This differs from `bun test`: the compiler assumes that built-in objects do not change.
  test.concurrent("built-in objects are immutable, and spyOn says so", async () => {
    using dir = tempDir("test-aot", {
      "builtins.test.ts": `
        import { expect, setSystemTime, spyOn, test } from "bun:test";
        test("spyOn", () => {
          expect(() => spyOn(Math, "random")).toThrow("Cannot spy on \`random\`: built-in objects are immutable");
          expect(() => spyOn(Date, "now")).toThrow(TypeError);
          expect(() => spyOn(Array.prototype, "push")).toThrow(TypeError);
          expect(() => { Math.random = () => 0.5; }).toThrow(TypeError);
        });
        test("what is not a built-in object of the language", () => {
          const log = spyOn(console, "log").mockImplementation(() => {});
          console.log("hidden");
          expect(log).toHaveBeenCalledTimes(1);
          log.mockRestore();
          const frozen = Object.freeze({ method: () => "real" });
          expect(spyOn(frozen, "method").mockReturnValue("mocked")()).toBe("mocked");
          setSystemTime(new Date(0));
          expect(Date.now()).toBe(0);
          setSystemTime();
        });
      `,
    });
    const { stderr, exitCode } = await runTests(String(dir), true);
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.concurrent("mock.module and spies", async () => {
    const { stderr } = await expectSameAsBunTest({
      "mock.test.ts": `
        import { expect, mock, spyOn, test } from "bun:test";
        import * as target from "./target";
        test("spyOn", () => {
          const object = { method: () => "real" };
          const spy = spyOn(object, "method").mockReturnValue("mocked");
          expect(object.method()).toBe("mocked");
          expect(spy).toHaveBeenCalledTimes(1);
        });
        test("mock", () => {
          const fn = mock((n: number) => n * 2);
          expect(fn(21)).toBe(42);
          expect(fn.mock.calls).toEqual([[21]]);
          expect(target.value()).toBe("real");
        });
      `,
      "target.ts": `export const value = () => "real";`,
    });
    expect(stderr).toContain(" 2 pass");
  });

  test.concurrent("an error in the build", async () => {
    using dir = tempDir("test-aot", { "bad.test.ts": `import "./does-not-exist";` });
    const { stderr, exitCode } = await runTests(String(dir), true, [], false);
    // The bundler's error message.
    expect(stderr).toContain(`Could not resolve: "./does-not-exist"`);
    expect(exitCode).toBe(1);
  });
});
