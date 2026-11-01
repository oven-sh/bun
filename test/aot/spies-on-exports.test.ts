import { expect } from "bun:test";
import { describe } from "./harness/declare";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

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
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
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

test("a spy reaches a name of a CommonJS file through the files that export it again, for those who read the namespace objects", async () => {
  await expectCompiledToRunAsPlain({
    "node_modules/cjs-pkg/package.json": `{ "name": "cjs-pkg", "main": "index.js" }`,
    "node_modules/cjs-pkg/index.js": `exports.add = function add(a, b) { return a + b; };`,
    "local.cjs": `exports.add = function add(a, b) { return a + b; };`,
    "named.ts": `
      export { add as packageAdd } from "cjs-pkg";
      export { add as localAdd } from "./local.cjs";`,
    "twice.ts": `export { packageAdd as again } from "./named";`,
    "star.ts": `export * from "cjs-pkg";`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as pkg from "cjs-pkg";
      import * as local from "./local.cjs";
      import * as named from "./named";
      import * as twice from "./twice";
      import * as star from "./star";
      const all: [any, string][] = [[pkg, "add"], [local, "add"], [named, "packageAdd"], [named, "localAdd"], [twice, "again"], [star, "add"]];
      const read = () => JSON.stringify(all.map(([holder, name]) => holder[name](1, 2)));
      test("each in its turn", () => {
        for (const [holder, name] of all) {
          const spy = spyOn(holder, name).mockImplementation(() => 105);
          console.log(name, read(), pkg.add(1, 2), local.add(1, 2), named.packageAdd(1, 2), named.localAdd(1, 2), twice.again(1, 2), star.add(1, 2), spy.mock.calls.length);
          spy.mockRestore();
          console.log(name, "restored", read());
        }
      });
      test("by a name that is written out", () => {
        const spy = spyOn(named, "packageAdd").mockImplementation(() => 105);
        console.log(read(), spy.mock.calls.length);
        spy.mockRestore();
      });`,
  });
});

test("a spy under names out of a list replaces each", async () => {
  const files = {
    "doors.ts": `
      export function front(): string { return "front"; }
      export function back(): string { return "back"; }
      export function side(): string { return front() + back(); }`,
    "house.ts": `import { back, front, side } from "./doors";\nexport const show = () => console.log(front(), back(), side());`,
    "preload.ts": `
      import { beforeEach, spyOn } from "bun:test";
      import * as fs from "node:fs";
      import * as doors from "./doors";
      beforeEach(async () => {
        for (const door of ["front", "back"] as const) spyOn(doors, door).mockImplementation(() => "guarded " + door);
        for (const name of ["existsSync", "accessSync"] as const) spyOn(fs, name).mockImplementation((() => "guarded") as never);
      });`,
    "one.test.ts": `
      import { mock, test } from "bun:test";
      import { existsSync } from "node:fs";
      import { show } from "./house";
      test("guarded", () => { show(); console.log(existsSync(".")); mock.restore(); show(); console.log(existsSync(".")); });`,
  };
  await expectCompiledToRunAsPlain(files, "--preload", "./preload.ts");

  using dir = tempDir("spies-on-exports", files);
  const { stderr } = await run([bunExe(), "test", "--debug-aot", "--preload", "./preload.ts"], String(dir), {
    ...bunEnv,
    BUN_JSC_logAOTPhaseTimes: "1",
  });
  expect(stderr).toContain("AOT phase times: front end | Load");
  expect(stderr).not.toMatch(/AOT build starts over \| replaced exports 0 > [1-9]/);
});

test("a spy on an unknown object beside a load under an unknown path takes one first load", async () => {
  using dir = tempDir("spies-on-exports", {
    "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`,
    "a.ts": `export function name(): string { return "real"; }`,
    "b.ts": `import { name } from "./a";\nexport const show = () => name();`,
    "preload.ts": `
      import { spyOn } from "bun:test";
      export const hold = (object: any, key: string) => spyOn(object, key);`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { show } from "./b";
      import { hold } from "./preload";
      const load = (path: string) => import(path);
      test("spied", async () => {
        const a = await load("./a");
        hold(a, "name").mockReturnValue("spied");
        console.log(show());
      });`,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--debug-aot"], String(dir), {
    ...bunEnv,
    BUN_JSC_logAOTPhaseTimes: "1",
  });
  expect(stdout).toContain("spied");
  expect(stderr).toContain("AOT phase times:");
  expect(stderr).not.toMatch(/AOT build starts over \| replaced exports 0 > [1-9]/);
});

describe("a spy on what the front end sees handed over takes one first load", () => {
  const files = {
    "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`,
    "x.ts": `export function one(): string { return "one"; }\nexport const TEXT = "text";`,
    "nested.ts": `export * as nested from "./x";`,
    "helper.ts": `import { spyOn } from "bun:test";\nexport const hold = (o: any, k: any) => spyOn(o, k);`,
  };
  test.each([
    [
      "an awaited import() in a variable",
      ``,
      `const ns = await import("./x"); spyOn(ns, "one").mockReturnValue("spied");`,
    ],
    ["an awaited import() as the operand", ``, `spyOn(await import("./x"), "one").mockReturnValue("spied");`],
    ["import().then()", ``, `await import("./x").then(m => spyOn(m, "one").mockReturnValue("spied"));`],
    ["require() as the operand", ``, `spyOn(require("./x"), "one").mockReturnValue("spied");`],
    ["a helper handed import()", ``, `hold(await import("./x"), "one").mockReturnValue("spied");`],
    [
      "a helper handed a namespace under a name",
      `import * as n from "./nested";`,
      `hold(n.nested, "one").mockReturnValue("spied");`,
    ],
  ])("%s", async (_, imports, spy) => {
    using dir = tempDir("spies-on-exports", {
      ...files,
      "one.test.ts": `
        import { spyOn, test } from "bun:test";
        import { hold } from "./helper";
        import { one } from "./x";
        ${imports}
        test("spied", async () => { ${spy} console.log(one()); });`,
    });
    const { stdout, stderr } = await run([bunExe(), "test", "--debug-aot"], String(dir), {
      ...bunEnv,
      BUN_JSC_logAOTPhaseTimes: "1",
    });
    expect(stdout).toContain("spied");
    expect(stderr).toContain("AOT phase times:");
    expect(stderr).not.toMatch(/AOT build starts over \| replaced exports 0 > [1-9]/);
  });
});

test("a helper that is handed the namespace object and the name replaces the export", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "one.test.ts": `${imports}
      function replace(holder: object, name: string) { return spyOn(holder as any, name as any).mockReturnValue(9 as never); }
      test("replaced", () => { const spy = replace(math, "add"); ${show} spy.mockRestore(); ${show} });`,
  });
});

test("a spy on an object from somewhere replaces the export that goes by its name, in every module that is handed on", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "shapes.ts": `export function add(a: string, b: string): string { return a + b; }\nexport function half(text: string): string { return text.slice(0, text.length / 2); }`,
    "holders.ts": `import * as math from "./math";\nimport * as shapes from "./shapes";\nexport const holders: Record<string, any>[] = [math, shapes, { add: () => "own" }];`,
    "one.test.ts": `${imports}
      import { holders } from "./holders";
      import { add as join, half as cut } from "./shapes";
      test("replaced", () => {
        const spies = holders.map(holder => spyOn(holder, "add").mockReturnValue("spied"));
        ${show}
        console.log(join("a", "b"), cut("abcd"), holders[2].add());
        for (const spy of spies) spy.mockRestore();
        ${show}
        console.log(join("a", "b"), cut("abcd"), holders[2].add());
      });`,
  });
});

test("a spy on an object from somewhere under a name out of a list, a constant, a parameter or another file", async () => {
  await expectCompiledToRunAsPlain({
    ...math,
    "watch.ts": `import { spyOn } from "bun:test";\nexport function watch(holder: any, name: string) { return spyOn(holder, name).mockReturnValue(5 as never); }`,
    "one.test.ts": `${imports}
      import { watch } from "./watch";
      const holder: Record<string, any> = { it: math };
      const restore = (spies: { mockRestore(): void }[]) => { ${show} for (const spy of spies) spy.mockRestore(); ${show} };
      test("a list", () => restore(["add", "half"].map(name => spyOn(holder.it, name).mockReturnValue(1))));
      test("a loop", () => { const spies = []; for (const name of ["twice"]) spies.push(spyOn(holder.it, name).mockReturnValue(2)); restore(spies); });
      test("a constant", () => { const name = "half"; restore([spyOn(holder.it, name as any).mockReturnValue(3)]); });
      test("a parameter", () => { const own = (name: string) => spyOn(holder.it, name).mockReturnValue(4); restore([own("add"), own("twice")]); });
      test("another file", () => restore([watch(holder.it, "add"), watch(holder.it, "half")]));`,
  });
});

// A namespace object that goes somewhere is opened only where a spy takes an object from somewhere. Such a spy is not always a call of `spyOn`.
describe("a namespace object that goes somewhere reaches a spy that is called under another name", () => {
  const holder = `const holder: Record<string, any> = { it: math };`;
  const replaced = (spy: string) =>
    `test("replaced", () => { const spy = ${spy}.mockReturnValue(9); ${show} spy.mockRestore(); ${show} });`;
  test.each([
    ["a variable", `const watch = spyOn; ${replaced(`watch(holder.it, "add")`)}`],
    ["a name taken out of jest", `const { spyOn: watch } = jest; ${replaced(`watch(holder.it, "add")`)}`],
    ["vi in a variable", `const runner = vi; ${replaced(`runner.spyOn(holder.it, "add")`)}`],
    ["a list of operands", `const operands = [holder.it, "add"] as const; ${replaced(`spyOn(...operands)`)}`],
    ["call()", replaced(`spyOn.call(undefined, holder.it, "add")`)],
    ["the object of bun:test", `import * as runner from "bun:test"; ${replaced(`runner.spyOn(holder.it, "add")`)}`],
    ["require", replaced(`require("bun:test").spyOn(holder.it, "add")`)],
  ])("%s", async (_, text) => {
    await expectCompiledToRunAsPlain({ ...math, "one.test.ts": `${imports}\n${holder}\n${text}` });
  });

  test("a file that exports it again", async () => {
    await expectCompiledToRunAsPlain({
      ...math,
      "again.ts": `export { spyOn as watch } from "bun:test";`,
      "named.ts": `import { spyOn } from "bun:test";\nexport { spyOn as look };`,
      "one.test.ts": `${imports}
        import { watch } from "./again";
        import { look } from "./named";
        ${holder}
        ${replaced(`watch(holder.it, "add")`)}
        test("and once more", () => { const spy = look(holder.it, "half").mockReturnValue(3); ${show} spy.mockRestore(); ${show} });`,
    });
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

test("a namespace object handed to a helper that spies does not build the program again for its exports", async () => {
  using dir = tempDir("spies-on-exports", {
    ...math,
    "one.test.ts": `${imports}
      function replace<T extends object>(holder: T, name: keyof T & string) {
        return spyOn(holder, name as never);
      }
      test("replaced", () => {
        const name = ["a", "dd"].join("") as "add";
        const spy = replace(math, name);
        console.log(byName(1, 2), byNamespace(1, 2));
        expect(spy).toHaveBeenCalledTimes(2);
      });`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--debug-aot"], String(dir), {
    ...bunEnv,
    BUN_JSC_logAOTPhaseTimes: "1",
  });
  expect(stdout).toContain("3 3");
  expect(stderr).toContain("AOT phase times: front end | Load");
  expect(stderr).not.toMatch(/AOT build starts over \| replaced exports 0 > [1-9]/);
  expect(exitCode).toBe(0);
});

// Nothing follows the name here, so only that build can tell.
for (const [name, words, loads] of [["analysis switched off", "disable=flow-results", 2]] as const)
  test(`${name}: a spy may replace any export, and a mock any module, after ${loads} loads`, async () => {
    using dir = tempDir("spies-without-flow", {
      ...math,
      "preload.ts": `
      import { beforeEach, spyOn } from "bun:test";
      import * as math from "./math";
      const names: (keyof typeof math)[] = JSON.parse('["add", "half"]');
      beforeEach(() => {
        for (const name of names) spyOn(math, name).mockImplementation(() => 7);
      });`,
      "greeting.ts": `export function greet(): string { return "real"; }`,
      "one.test.ts": `
      import { expect, mock, test } from "bun:test";
      import { byName, byNamespace, insideTheModule, notSpiedOn } from "./user";
      import { greet } from "./greeting";
      test("spies", () => {
        expect([byName(1, 2), byNamespace(1, 2), insideTheModule(2), notSpiedOn(8)]).toEqual([7, 7, 7, 7]);
      });
      test("mock", () => {
        const member = JSON.parse('"module"') as "module";
        mock[member](import.meta.dir + "/greeting.ts", () => ({ greet: () => "mocked" }));
        expect(greet()).toBe("mocked");
      });`,
    });
    const flags = ["--preload", "./preload.ts"];
    const plain = await runTests(String(dir), ...flags);
    expect(plain.results).toEqual(["pass spies", "pass mock"]);
    const { stderr, exitCode } = await run([bunExe(), "test", "--debug-aot", ...flags], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
      BUN_JSC_logAOTPhaseTimes: "1",
    });
    expect(stderr).toContain("(pass) spies");
    expect(stderr).toContain("(pass) mock");
    expect(exitCode).toBe(0);
    expect(stderr.match(/AOT phase times: front end \| Load/g)?.length).toBe(loads);
  });

test("a tsconfig.json in a package's own folder does not decide whether its exports can be replaced", async () => {
  await expectCompiledToRunAsPlain({
    "node_modules/@scope/pkg/package.json": `{ "name": "@scope/pkg", "version": "1.0.0", "type": "module", "exports": { "./src/*.js": "./src/*.ts" } }`,
    "node_modules/@scope/pkg/tsconfig.json": `{}`,
    "node_modules/@scope/pkg/src/tiny.ts": `export const tiny = async (x: number) => "real" + x;\nexport function plain() { return "real"; }`,
    "node_modules/@scope/pkg/src/caller.ts": `import { plain, tiny } from "./tiny.js";\nexport const call = async () => (await tiny(1)) + plain();`,
    "node_modules/@scope/pkg/src/mocked.ts": `export const value = () => "real";`,
    "node_modules/@scope/pkg/src/reader.ts": `import { value } from "./mocked.js";\nexport const read = () => value();`,
    "one.test.ts": `
      import { mock, spyOn, test } from "bun:test";
      import * as ns from "@scope/pkg/src/tiny.js";
      import { call } from "@scope/pkg/src/caller.js";
      import { read } from "@scope/pkg/src/reader.js";
      test("a spy", async () => {
        using one = spyOn(ns, "tiny").mockResolvedValue("spied");
        using two = spyOn(ns, "plain").mockReturnValue("!");
        console.log(await call(), await ns.tiny(2), ns.plain());
      });
      test("restored", async () => { console.log(await call()); });
      test("a mock", () => {
        console.log(read());
        mock.module("@scope/pkg/src/mocked.js", () => ({ value: () => "mocked" }));
        console.log(read());
      });`,
  });
});
