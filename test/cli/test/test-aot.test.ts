import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";

const supported = !isWindows;

function expectToHaveUsedImage(stderr: string) {
  expect(stderr).toContain("[aot] program data: ");
  expect(stderr).toContain("[aot] image: ");
  expect(stderr).not.toContain("[aot] not using");
  return stderr.replace(/^\[aot\] .*\n/gm, "");
}

const theReportOfAThrownErrorNamesTheSameLineAndAnotherColumnUnderAot =
  /^ +\^\n(error: thrown in a test\n +at <anonymous> \(<dir>\/a\.test\.ts:\d+):\d+\)/m;

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
    stderr: (aot && builds ? expectToHaveUsedImage(stderr) : stderr)
      .replaceAll(cwd, "<dir>")
      .replace(/ \[\d+(\.\d+)?m?s\]/g, "")
      .replace(theReportOfAThrownErrorNamesTheSameLineAndAnotherColumnUnderAot, "$1:<column>)"),
    exitCode,
  };
}

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

  test.concurrent("a preload under another tsconfig.json than the test", async () => {
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
    using dir = tempDir("test-aot", files);
    const refused = await runTests(String(dir), true, ["./sub/b.test.ts"], false);
    expect(refused.stderr).toContain(`the tsconfig.json of this file sets "experimentalDecorators" differently\n    at <dir>/decorated.ts`);
    expect(refused.stderr).not.toContain("at <dir>/preload.ts");
    expect(refused.exitCode).toBe(1);
  });

  test.concurrent("a preload that is right under its own tsconfig.json alone", async () => {
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
    const { stdout, stderr, exitCode } = await runTests(String(dir), true, [...flags, "a.test.ts"], false);
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

  test.concurrent("a spy that a preload outside the build sets on a compiled export", async () => {
    const options = `"target": "esnext", "module": "esnext", "moduleResolution": "bundler", "types": ["bun"], "skipLibCheck": true`;
    const { stdout, stderr } = await expectSameAsBunTest(
      {
        "tsconfig.json": `{ "compilerOptions": { ${options}, "strict": false } }`,
        "preload.ts": `
          import { spyOn } from "bun:test";
          import * as shared from "./lib/shared";
          function loose(value) { return value; }
          (globalThis as any).spyFromOutside = () => loose(spyOn(shared, "greet").mockReturnValue("spied"));
          (globalThis as any).readFromOutside = () => shared.greet("outside");
        `,
        "lib/shared.ts": `
          export function greet(name: string): string { return "hello " + name; }
          export function twice(name: string): string { return greet(name) + " " + greet(name); }
        `,
        "sub/tsconfig.json": `{ "compilerOptions": { ${options}, "strict": true } }`,
        "sub/a.test.ts": `
          import { expect, test } from "bun:test";
          import * as shared from "../lib/shared";
          import { greet, twice } from "../lib/shared";
          test("reaches compiled code", () => {
            const spy = (globalThis as any).spyFromOutside();
            console.log(greet("a"), shared.greet("b"), twice("c"), (globalThis as any).readFromOutside(), spy.mock.calls.length);
            expect(spy).toHaveBeenCalledTimes(5);
            spy.mockRestore();
            console.log(greet("a"), shared.greet("b"), twice("c"), (globalThis as any).readFromOutside());
          });
        `,
      },
      ["--preload", "./preload.ts", "./sub/a.test.ts"],
    );
    expect(stdout).toContain("spied spied spied spied spied 5\nhello a hello b hello c hello c hello outside\n");
    expect(stderr).toContain(" 1 pass");
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

  test.concurrent("test files of one name and several extensions", async () => {
    const file = (name: string) => `import { test } from "bun:test"; test("in ${name}", () => { console.log("ran ${name}"); });`;
    const { stderr } = await expectSameAsBunTest(
      Object.fromEntries(["a.test.js", "a.test.mjs", "a.test.ts", "a.test.tsx", "sub/a.test.ts"].map(name => [name, file(name)])),
    );
    expect(stderr).toContain(" 5 pass");
  });

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
          const frozen = Object.freeze({ method: (): string => "real" });
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

  test.concurrent("a method of a compiled class is not spied on in silence", async () => {
    using dir = tempDir("test-aot", {
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
        test("by a name that is not written down", () => {
          const other = new Other();
          expect(() => spyOn(other, ["r", "un"].join("") as any)).toThrow("Cannot replace method 'run' of Other");
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
          expect(() => spyOn(service, "calls")).toThrow(TypeError);
          expect(() => spyOn(new Client(), "sent")).toThrow(TypeError);
          expect(service.calls).toBe(0);
        });
      `,
    });
    const { stderr, exitCode } = await runTests(String(dir), true);
    expect(stderr).toContain(" 5 pass");
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

  test.concurrent("what a mock returns is held to the type by what it holds", async () => {
    const files = {
      "rules.ts": `
        export type Verdict = { allowed: true } | { allowed: false; reason: string };
        export type Answer = { ok: true; value: number } | { ok: false };
        export type Found = { parts: Record<string, { on: boolean }>; errors: { message: string }[] };
        export function check(n: number): Verdict { return n > 0 ? { allowed: true } : { allowed: false, reason: "low" }; }
        export async function ask(n: number): Promise<Answer> { return n > 0 ? { ok: true, value: n } : { ok: false }; }
        export function read(scope: string): Found { return { parts: { [scope]: { on: true } }, errors: [{ message: "kept" }, { message: "dropped" }] }; }
      `,
      "gate.ts": `
        import * as rules from "./rules";
        import { check, read } from "./rules";
        export function gate(n: number) { const v = rules.check(n); return v.allowed ? "yes" : v.reason; }
        export function gateByName(n: number) { const v = check(n); if (!v.allowed) return v.reason; return "yes"; }
        export async function gateLater(n: number) { const a = await rules.ask(n); return a.ok ? a.value : -1; }
        export function faults(scope: string) { return read(scope).errors.map(fault => fault.message).join(); }
      `,
      "spies.test.ts": `
        import { afterEach, expect, mock, spyOn, test } from "bun:test";
        import * as rules from "./rules";
        import { faults, gate, gateByName, gateLater } from "./gate";
        afterEach(() => { mock.restore(); });
        const denied = { allowed: false, reason: "named" };
        test("an object with a name of its own", () => {
          spyOn(rules, "check").mockReturnValue(denied as any);
          expect(gate(1)).toBe("named");
          expect(gateByName(1)).toBe("named");
        });
        test("an implementation whose type says nothing", () => {
          spyOn(rules, "check").mockImplementation((() => ({ allowed: false, reason: "implemented" })) as any);
          expect(gate(1)).toBe("implemented");
        });
        test("what a promise is resolved with", async () => {
          const answer = { ok: true, value: 7 };
          spyOn(rules, "ask").mockResolvedValue(answer as any);
          expect(await gateLater(0)).toBe(7);
        });
        test("what a generic helper made of the real result", () => {
          type Read = { parts: Record<string, unknown>; errors: readonly unknown[] };
          function first<T extends Read>(found: T): T { return { ...found, errors: found.errors.slice(0, 1) }; }
          const real = rules.read;
          spyOn(rules, "read").mockImplementation(scope => first(real(scope)));
          expect(faults("project")).toBe("kept");
        });
      `,
      "module.test.ts": `
        import { expect, mock, test } from "bun:test";
        mock.module("./rules", () => ({
          check: () => ({ allowed: false, reason: "mocked" }),
          ask: async () => ({ ok: true, value: 9 }),
          read: () => ({ parts: {}, errors: [] }),
        }));
        const { gate, gateByName, gateLater } = await import("./gate");
        test("mock.module", async () => {
          expect(gate(1)).toBe("mocked");
          expect(gateByName(1)).toBe("mocked");
          expect(await gateLater(0)).toBe(9);
        });
      `,
    };
    const [spies, module] = await Promise.all([expectSameAsBunTest(files, ["./spies.test.ts"]), expectSameAsBunTest(files, ["./module.test.ts"])]);
    expect(spies.stderr).toContain(" 4 pass");
    expect(spies.stderr).toContain(" 0 fail");
    expect(module.stderr).toContain(" 1 pass");
    expect(module.stderr).toContain(" 0 fail");
  });

  test.concurrent("spies on methods of objects of a class", async () => {
    const { stderr } = await expectSameAsBunTest({
      "service.ts": `
        export type Answer = { ok: true; value: string } | { ok: false; error: string };
        export class Client {
          private calls = 0;
          constructor(readonly base: string) {}
          get(id: number): Answer { this.calls++; return { ok: true, value: this.base + id }; }
          async later(id: number): Promise<Answer> { return this.get(id); }
          count() { return this.calls; }
        }
        export const client = new Client("real");
        export function nameOf(id: number) { const answer = client.get(id); return answer.ok ? answer.value : answer.error; }
        export async function nameLater(id: number) { const answer = await client.later(id); return answer.ok ? answer.value : answer.error; }
        export function nameFrom(from: Client, id: number) { const answer = from.get(id); return answer.ok ? answer.value : answer.error; }
      `,
      "spies.test.ts": `
        import { afterEach, expect, jest, mock, spyOn, test } from "bun:test";
        import { Client, client, nameFrom, nameLater, nameOf } from "./service";
        afterEach(() => { mock.restore(); });
        test("another value", () => {
          const spy = spyOn(client, "get").mockReturnValue({ ok: false, error: "down" });
          expect(nameOf(1)).toBe("down");
          expect(spy).toHaveBeenCalledWith(1);
          expect(nameFrom(new Client("fresh"), 3)).toBe("fresh3");
        });
        test("it is restored", () => { expect(nameOf(4)).toBe("real4"); });
        test("a spy that calls through", () => {
          const before = client.count();
          const spy = spyOn(client, "get");
          expect(nameOf(5)).toBe("real5");
          expect(spy).toHaveBeenCalledTimes(1);
          expect(client.count()).toBe(before + 1);
        });
        test("a value that stands under no type", () => {
          const named = { ok: false, error: "named" };
          spyOn(client, "get").mockReturnValue(named as any);
          expect(nameOf(6)).toBe("named");
        });
        test("an async method", async () => {
          spyOn(client, "later").mockResolvedValue({ ok: false, error: "late" });
          expect(await nameLater(7)).toBe("late");
        });
        test("jest.spyOn", () => {
          jest.spyOn(client, "get").mockReturnValue({ ok: true, value: "jest" });
          expect(nameOf(8)).toBe("jest");
        });
      `,
    });
    expect(stderr).toContain(" 6 pass");
    expect(stderr).toContain(" 0 fail");
  });

  test.concurrent("an error in the build", async () => {
    using dir = tempDir("test-aot", { "bad.test.ts": `import "./does-not-exist";` });
    const { stderr, exitCode } = await runTests(String(dir), true, [], false);
    expect(stderr).toContain("./does-not-exist");
    expect(exitCode).toBe(1);
  });
});
