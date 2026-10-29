import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(120_000);

const math = {
  "math.ts": `
    export function add(a: number, b: number): number { return a + b; }
    export function twice(n: number): number { return add(n, n); }
    export function half(n: number): number { return n / 2; }`,
  "user.ts": `
    import { add, half, twice } from "./math";
    import * as math from "./math";
    export function byName(a: number, b: number): number { return add(a, b); }
    export function byNamespace(a: number, b: number): number { return math.add(a, b); }
    export function insideTheModule(n: number): number { return twice(n); }
    export function notSpiedOn(n: number): number { return half(n); }`,
};
const uses = `console.log(byName(1, 2), byNamespace(1, 2), insideTheModule(2), math.add(1, 2), math["add"](1, 2), notSpiedOn(8));`;
const imports = `
  import { expect, jest, mock, spyOn, test, vi } from "bun:test";
  import * as math from "./math";
  import { byName, byNamespace, insideTheModule, notSpiedOn } from "./user";`;

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("spies-on-exports", files);
  const plain = await runTests(String(dir), ...flags);
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--debug-aot", ...flags)).toEqual(plain);
}

test("a spy on an export records calls from importers and from the module itself", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      test("recorded", () => {
        const spy = spyOn(math, "add");
        ${uses}
        console.log(JSON.stringify(spy.mock.calls), JSON.stringify(spy.mock.results));
        expect(spy).toHaveBeenCalledTimes(5);
      });`,
  });
});

test("a spy's implementation replaces the export, and mockRestore() gives it back", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      test("replaced", () => {
        ${uses}
        const spy = spyOn(math, "add").mockReturnValue(99);
        ${uses}
        spy.mockImplementation((a, b) => a * b);
        ${uses}
        spy.mockRestore();
        ${uses}
      });`,
  });
});

test("mock.restore() gives back every export that was spied on", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      test("restored", () => {
        spyOn(math, "add").mockReturnValue(1);
        spyOn(math, "twice").mockReturnValue(2);
        ${uses}
        mock.restore();
        ${uses}
      });`,
  });
});

test("jest.spyOn and vi.spyOn replace an export", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      test("jest", () => { const spy = jest.spyOn(math, "add").mockReturnValue(5); ${uses} spy.mockRestore(); ${uses} });
      test("vi", () => { const spy = vi.spyOn(math, "twice").mockReturnValue(6); ${uses} spy.mockRestore(); ${uses} });`,
  });
});

test("a preload spies on an export for every test file", async () => {
  await expectCompiledToRunAsPlain(
    {
      "log.ts": `export function logEvent(name: string): string { return "real " + name; }`,
      "app.ts": `import { logEvent } from "./log";\nexport function start(name: string): string { return logEvent(name); }`,
      "preload.ts": `
        import { beforeEach, spyOn } from "bun:test";
        import * as log from "./log";
        const spy = spyOn(log, "logEvent").mockImplementation(name => "spied " + name);
        beforeEach(() => { spy.mockClear(); });
        (globalThis as any).logSpy = spy;`,
      "a.test.ts": `
        import { expect, test } from "bun:test";
        import { start } from "./app";
        test("a", () => { console.log(start("a")); expect((globalThis as any).logSpy).toHaveBeenCalledTimes(1); });`,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { start } from "./app";
        test("b", () => { console.log(start("b")); expect((globalThis as any).logSpy).toHaveBeenCalledWith("b"); });`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("a spy on a name that another module exports again reaches the module that declares it", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "barrel.ts": `export { add } from "./math";\nexport * from "./user";`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as barrel from "./barrel";
      import * as math from "./math";
      test("through a barrel", () => {
        const spy = spyOn(barrel, "add").mockReturnValue(7);
        console.log(barrel.add(1, 2), math.add(1, 2), barrel.byName(1, 2), barrel.insideTheModule(1));
        spy.mockRestore();
        console.log(barrel.add(1, 2), math.add(1, 2), barrel.byName(1, 2), barrel.insideTheModule(1));
      });`,
  });
});

test("a spy replaces an arrow function, a class and a default export", async () => {
  await expectCompiledToRunAsPlain({
    "things.ts": `
      export const arrow = (n: number): number => n + 1;
      export class Thing { name(): string { return "thing"; } }
      export default function main(): string { return "main"; }
      export function useAll(): string { return [arrow(1), new Thing().name(), main()].join(); }`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as things from "./things";
      import main, { arrow, Thing, useAll } from "./things";
      const show = () => console.log(arrow(1), new Thing().name(), main(), useAll());
      test("replaced", () => {
        show();
        const spies = [
          spyOn(things, "arrow").mockReturnValue(10),
          spyOn(things, "Thing").mockImplementation(function () { return { name: () => "mocked thing" }; } as any),
          spyOn(things, "default").mockReturnValue("mocked main"),
        ];
        show();
        for (const spy of spies) spy.mockRestore();
        show();
      });`,
  });
});

test("a spy replaces an export of a node: module for those who import the name or read the namespace", async () => {
  await expectCompiledToRunAsPlain({
    "io.ts": `
      import fsObject, { existsSync } from "node:fs";
      import * as fs from "node:fs";
      import { join } from "node:path";
      import { hostname } from "node:os";
      export const show = () =>
        console.log(existsSync("/no/such/file"), fs.existsSync("/no/such/file"), fsObject.existsSync("/no/such/file"), join("a", "b"), typeof hostname());`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as fs from "node:fs";
      import * as os from "node:os";
      import * as path from "node:path";
      import { show } from "./io";
      test("replaced", () => {
        show();
        const spies = [
          spyOn(fs, "existsSync").mockReturnValue(true),
          spyOn(path, "join").mockReturnValue("joined"),
          spyOn(os, "hostname").mockReturnValue(5 as any),
          spyOn(os, "uptime").mockReturnValue(6),
        ];
        show();
        console.log(fs.existsSync("/no/such/file"), path.join("a"), os.hostname(), os.uptime(), spies[0].mock.calls.length);
        for (const spy of spies) spy.mockRestore();
        show();
        console.log(fs.existsSync("/no/such/file"), path.join("a"), typeof os.hostname(), typeof os.uptime());
      });`,
  });
});

test("a spy replaces a name of a CommonJS file for the ES modules that import it", async () => {
  await expectCompiledToRunAsPlain({
    "legacy.cjs": `exports.greet = function (name) { return "hello " + name; };\nexports.twice = function (name) { return exports.greet(name) + exports.greet(name); };`,
    "user.ts": `import { greet, twice } from "./legacy.cjs";\nexport const show = () => console.log(greet("a"), twice("b"));`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as legacy from "./legacy.cjs";
      import { show } from "./user";
      test("replaced", () => {
        show();
        const spy = spyOn(legacy, "greet").mockReturnValue("mocked");
        show();
        console.log(legacy.greet("c"), legacy.twice("d"));
        spy.mockRestore();
        show();
      });`,
  });
});

const show = `console.log(byName(1, 2), byNamespace(1, 2), insideTheModule(2), notSpiedOn(8));`;

test("a helper that is handed the namespace object and the name replaces the export", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      function replace(holder: object, name: string) { return spyOn(holder as any, name as any).mockReturnValue(9 as never); }
      test("replaced", () => { const spy = replace(math, "add"); ${show} spy.mockRestore(); ${show} });`,
  });
});

test("a spy under a name that the build can't know replaces any export of the module", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      test("replaced", () => {
        const names = Object.keys(math).filter(name => name !== process.env.KEPT);
        const spies = names.map(name => spyOn(math, name as "add").mockReturnValue(7));
        ${show}
        for (const spy of spies) spy.mockRestore();
        ${show}
      });`,
  });
});

test("a spy and a namespace object that the build loses sight of", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      test("replaced", () => {
        const anywhere = globalThis as any;
        anywhere[process.env.TOOL ?? "tool"] = spyOn;
        anywhere[process.env.HELD ?? "held"] = math;
        const spy = anywhere.tool(anywhere.held, "add").mockReturnValue(5);
        ${show}
        spy.mockRestore();
        ${show}
      });`,
  });
});

test("a spy on what import() and require() answer", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import { byName, byNamespace, insideTheModule, notSpiedOn } from "./user";
      test("import()", async () => {
        const math = await import("./math");
        const spy = spyOn(math, "add").mockReturnValue(3);
        ${show}
        spy.mockRestore();
        ${show}
      });
      test("require()", () => {
        const [math] = [require("./math")];
        const spy = spyOn(math, "twice").mockReturnValue(40);
        ${show}
        spy.mockRestore();
        ${show}
      });`,
  });
});
