import { afterAll, describe, expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

// Every test runs a project of its own, or waits for the two runs of the project that the cases with spelled spies share, so the
// tests run at once: as many as --max-concurrency allows. Not on a debug build of Bun: there the longest build takes a third of
// the time limit of its test with nothing beside it, and ran out of it beside four others.
const test = isDebug ? oneAtATime : oneAtATime.concurrent;

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

/** What the test files of a run show: the lines that they print, and how each of their tests ends. */
type Shown = { printed: string[]; results: string[] };
type Run = Awaited<ReturnType<typeof runTests>>;

const resultsIn = (log: string[]) =>
  log.flatMap(line => /^\((pass|fail)\) (.*?)(?: \[.*\])?$/.exec(line)?.slice(1).join(" ") ?? []);

function linesOf(text: string) {
  const lines = text.split("\n");
  // What follows the last line break is a line only if something stands there.
  if (!lines.at(-1)) lines.pop();
  return lines;
}

/** `bun test` in a directory. A compiled run also tells what its build logged. */
async function runTests(directory: string, flags: string[] = [], words?: string) {
  const env = {
    ...bunEnv,
    ...(flags.includes("--debug-aot") && { BUN_JSC_logAOTPhaseTimes: "1" }),
    ...(words && { BUN_DEBUG_TEST_AOT_WORDS: words }),
  };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  const log = stderr.split("\n");
  return {
    ended: {
      // Every line but the first, which names this Bun.
      printed: linesOf(stdout.replace(/^bun test v.*\n/, "")),
      results: resultsIn(log),
      // A run that fails says why there, and a crash prints only there. What the build logs of itself is left out.
      stderr: exitCode ? log.filter(line => !/^(AOT | {2}\w+: wall \d)/.test(line)).join("\n") : "",
      exitCode,
    },
    log,
    // The first scan is that of the test files.
    scan: log.find(line => line.startsWith("AOT test run | scan of ")),
    build: {
      loads: log.filter(line => line.startsWith("AOT phase times: front end | Load")).length,
      startsOver: log.filter(line => line.startsWith("AOT build starts over")),
    },
  };
}

/** What a build says that found everything in the first load of the files: nothing sent it back to load them again. */
const oneLoad = { loads: 1, startsOver: [] as string[] };

/** A project of these files ends as `expected` says under plain `bun test`, and the same compiled. Answers the compiled run. */
async function expectCompiledToRunAsPlain(expected: Shown, files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("spies-on-exports", files);
  const plain = await runTests(String(dir), flags);
  expect(plain.ended).toEqual({ ...expected, stderr: "", exitCode: 0 });
  const compiled = await runTests(String(dir), ["--debug-aot", ...flags]);
  expect(compiled.ended).toEqual(plain.ended);
  // A run that built nothing would end as the plain one too.
  expect(compiled.build.loads).toBeGreaterThan(0);
  return compiled;
}

// The cases whose spies each spell a file of the case and a name are the folders of one project, which runs once plain and once
// compiled. For such a spy the build opens the export that it names, in the files of that folder, so no case changes what the
// build knows about another. What else a test replaces reaches past its folder, so such a case has a build of its own: a module
// of Bun, what a preload or a mock replaces, and whatever a spy opens that takes its object or its name from somewhere.
const spelled = {
  files: {} as Record<string, string>,
  cases: 0,
  project: undefined as ReturnType<typeof tempDir> | undefined,
  runs: undefined as Promise<{ plain: Run; compiled: Run }> | undefined,
};
afterAll(() => spelled.project?.[Symbol.dispose]());

function ranSpelled() {
  return (spelled.runs ??= (async () => {
    spelled.project = tempDir("spies-on-exports", spelled.files);
    const plain = await runTests(String(spelled.project));
    return { plain, compiled: await runTests(String(spelled.project), ["--debug-aot"]) };
  })());
}

/** A folder's part of a run: its test file prints the folder first, and `bun test` names the file above its results. */
function inFolder(folder: string, { ended, log }: Run): Shown {
  // The next folder ends the part, and so does the count of the tests that passed, below the last file.
  const ends = /^(c\d+(:|[\\/]one\.test\.ts:)| *\d+ pass)$/;
  const below = (lines: string[], first: string) => {
    const start = lines.indexOf(first) + 1;
    const end = lines.findIndex((line, index) => index >= start && ends.test(line));
    return start ? lines.slice(start, end < 0 ? undefined : end) : [];
  };
  return {
    printed: below(ended.printed, `${folder}:`),
    results: resultsIn(below(log, `${join(folder, "one.test.ts")}:`)),
  };
}

function spelledSpy(title: string, expected: Shown, files: Record<string, string>) {
  const folder = `c${String(++spelled.cases).padStart(2, "0")}`;
  for (const [path, text] of Object.entries(files))
    spelled.files[`${folder}/${path}`] = path === "one.test.ts" ? `console.log("${folder}:");\n${text}` : text;
  test(title, async () => {
    const { plain, compiled } = await ranSpelled();
    expect(inFolder(folder, plain)).toEqual(expected);
    expect(inFolder(folder, compiled)).toEqual(inFolder(folder, plain));
  });
}

spelledSpy(
  "a spy on an export records calls from importers and from the module itself",
  {
    printed: [
      "3 3 4 3 3 4",
      '[[1,2],[1,2],[2,2],[1,2],[1,2]] [{"type":"return","value":3},{"type":"return","value":3},{"type":"return","value":4},{"type":"return","value":3},{"type":"return","value":3}]',
    ],
    results: ["pass recorded"],
  },
  {
    ...math,
    "one.test.ts": `${imports}
      test("recorded", () => {
        const spy = spyOn(math, "add");
        ${uses}
        console.log(JSON.stringify(spy.mock.calls), JSON.stringify(spy.mock.results));
        expect(spy).toHaveBeenCalledTimes(5);
      });`,
  },
);

spelledSpy(
  "a spy's implementation replaces the export, and mockRestore() gives it back",
  { printed: ["3 3 4 3 3 4", "99 99 99 99 99 4", "2 2 4 2 2 4", "3 3 4 3 3 4"], results: ["pass replaced"] },
  {
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
  },
);

spelledSpy(
  "mock.restore() gives back every export that was spied on",
  { printed: ["1 1 2 1 1 4", "3 3 4 3 3 4"], results: ["pass restored"] },
  {
    ...math,
    "one.test.ts": `${imports}
      test("restored", () => {
        spyOn(math, "add").mockReturnValue(1);
        spyOn(math, "twice").mockReturnValue(2);
        ${uses}
        mock.restore();
        ${uses}
      });`,
  },
);

spelledSpy(
  "jest.spyOn and vi.spyOn replace an export",
  { printed: ["5 5 5 5 5 4", "3 3 4 3 3 4", "3 3 6 3 3 4", "3 3 4 3 3 4"], results: ["pass jest", "pass vi"] },
  {
    ...math,
    "one.test.ts": `${imports}
      test("jest", () => { const spy = jest.spyOn(math, "add").mockReturnValue(5); ${uses} spy.mockRestore(); ${uses} });
      test("vi", () => { const spy = vi.spyOn(math, "twice").mockReturnValue(6); ${uses} spy.mockRestore(); ${uses} });`,
  },
);

test("a preload spies on an export for every test file", async () => {
  const expected = { printed: ["spied a", "spied b"], results: ["pass a", "pass b"] };
  await expectCompiledToRunAsPlain(
    expected,
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

spelledSpy(
  "a spy on a name that another module exports again reaches the module that declares it",
  { printed: ["7 7 7 7", "3 3 3 2"], results: ["pass through a barrel"] },
  {
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
  },
);

spelledSpy(
  "a spy replaces an arrow function, a class and a default export",
  {
    printed: [
      "2 thing main 2,thing,main",
      "10 mocked thing mocked main 10,mocked thing,mocked main",
      "2 thing main 2,thing,main",
    ],
    results: ["pass replaced"],
  },
  {
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
  },
);

test("a spy replaces an export of a node: module for those who import the name or read the namespace", async () => {
  const expected = {
    printed: [
      `false false false ${join("a", "b")} string`,
      "true true false joined number",
      "true joined 5 6 3",
      `false false false ${join("a", "b")} string`,
      "false a string number",
    ],
    results: ["pass replaced"],
  };
  await expectCompiledToRunAsPlain(expected, {
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

spelledSpy(
  "a spy replaces a name of a CommonJS file for the ES modules that import it",
  {
    printed: ["hello a hello bhello b", "mocked hello bhello b", "mocked hello dhello d", "hello a hello bhello b"],
    results: ["pass replaced"],
  },
  {
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
  },
);

// The seven cases tell the build nothing about one another while the scan of their test files finds the eleven spies by file and
// name and nothing else: no whole module, no module object that is handed on, nothing for a spy or a mock that nobody sees. Nor
// may flow find an export behind the scan: that starts the build over.
test("the spies that spell the module and the name open their exports and nothing else, in one load", async () => {
  const { plain, compiled } = await ranSpelled();
  expect({ stderr: plain.ended.stderr, exitCode: plain.ended.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(compiled.ended).toEqual(plain.ended);
  expect(compiled.scan).toContain(
    "| sites: built-ins 0 | names added 0 | exports 11 | modules 0 | handed on 0 | mocks any module false | hands on any module false | spies on objects from somewhere false",
  );
  expect(compiled.build).toEqual(oneLoad);
});

const show = `console.log(byName(1, 2), byNamespace(1, 2), insideTheModule(2), notSpiedOn(8));`;

test("a spy reaches a name of a CommonJS file through the files that export it again, for those who read the namespace objects", async () => {
  const expected = {
    printed: [
      "add [105,3,105,3,105,105] 105 3 105 3 105 105 8",
      "add restored [3,3,3,3,3,3]",
      "add [3,105,3,105,3,3] 3 105 3 105 3 3 4",
      "add restored [3,3,3,3,3,3]",
      "packageAdd [105,3,105,3,105,105] 105 3 105 3 105 105 8",
      "packageAdd restored [3,3,3,3,3,3]",
      "localAdd [3,105,3,105,3,3] 3 105 3 105 3 3 4",
      "localAdd restored [3,3,3,3,3,3]",
      "again [105,3,105,3,105,105] 105 3 105 3 105 105 8",
      "again restored [3,3,3,3,3,3]",
      "add [105,3,105,3,105,105] 105 3 105 3 105 105 8",
      "add restored [3,3,3,3,3,3]",
      "[105,3,105,3,105,105] 4",
    ],
    results: ["pass each in its turn", "pass by a name that is written out"],
  };
  await expectCompiledToRunAsPlain(expected, {
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
  const expected = {
    printed: ["guarded front guarded back guarded frontguarded back", "guarded", "front back frontback", "true"],
    results: ["pass guarded"],
  };
  const compiled = await expectCompiledToRunAsPlain(expected, files, "--preload", "./preload.ts");
  expect(compiled.build).toEqual(oneLoad);
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
  const compiled = await runTests(String(dir), ["--debug-aot"]);
  expect(compiled.ended).toEqual({ printed: ["spied"], results: ["pass spied"], stderr: "", exitCode: 0 });
  expect(compiled.build).toEqual(oneLoad);
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
    const compiled = await runTests(String(dir), ["--debug-aot"]);
    expect(compiled.ended).toEqual({ printed: ["spied"], results: ["pass spied"], stderr: "", exitCode: 0 });
    expect(compiled.build).toEqual(oneLoad);
  });
});

test("a helper that is handed the namespace object and the name replaces the export", async () => {
  const expected = { printed: ["9 9 9 4", "3 3 4 4"], results: ["pass replaced"] };
  await expectCompiledToRunAsPlain(expected, {
    ...math,
    "one.test.ts": `${imports}
      function replace(holder: object, name: string) { return spyOn(holder as any, name as any).mockReturnValue(9 as never); }
      test("replaced", () => { const spy = replace(math, "add"); ${show} spy.mockRestore(); ${show} });`,
  });
});

test("a spy on an object from somewhere replaces the export that goes by its name, in every module that is handed on", async () => {
  const expected = {
    printed: ["spied spied spied 4", "spied ab spied", "3 3 4 4", "ab ab own"],
    results: ["pass replaced"],
  };
  await expectCompiledToRunAsPlain(expected, {
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
  const expected = {
    printed: [
      "1 1 1 1",
      "3 3 4 4",
      "3 3 2 4",
      "3 3 4 4",
      "3 3 4 3",
      "3 3 4 4",
      "4 4 4 4",
      "3 3 4 4",
      "5 5 5 5",
      "3 3 4 4",
    ],
    results: ["pass a list", "pass a loop", "pass a constant", "pass a parameter", "pass another file"],
  };
  await expectCompiledToRunAsPlain(expected, {
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
  const expected = { printed: ["9 9 9 4", "3 3 4 4"], results: ["pass replaced"] };
  test.each([
    ["a variable", `const watch = spyOn; ${replaced(`watch(holder.it, "add")`)}`],
    ["a name taken out of jest", `const { spyOn: watch } = jest; ${replaced(`watch(holder.it, "add")`)}`],
    ["vi in a variable", `const runner = vi; ${replaced(`runner.spyOn(holder.it, "add")`)}`],
    ["a list of operands", `const operands = [holder.it, "add"] as const; ${replaced(`spyOn(...operands)`)}`],
    ["call()", replaced(`spyOn.call(undefined, holder.it, "add")`)],
    ["the object of bun:test", `import * as runner from "bun:test"; ${replaced(`runner.spyOn(holder.it, "add")`)}`],
    ["require", replaced(`require("bun:test").spyOn(holder.it, "add")`)],
  ])("%s", async (_, text) => {
    await expectCompiledToRunAsPlain(expected, { ...math, "one.test.ts": `${imports}\n${holder}\n${text}` });
  });

  test("a file that exports it again", async () => {
    const both = {
      printed: ["9 9 9 4", "3 3 4 4", "3 3 4 3", "3 3 4 4"],
      results: ["pass replaced", "pass and once more"],
    };
    await expectCompiledToRunAsPlain(both, {
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
  const expected = { printed: ["7 7 7 7", "3 3 4 4"], results: ["pass replaced"] };
  await expectCompiledToRunAsPlain(expected, {
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
  const expected = { printed: ["5 5 5 4", "3 3 4 4"], results: ["pass replaced"] };
  await expectCompiledToRunAsPlain(expected, {
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
  const expected = {
    printed: ["3 3 3 4", "3 3 4 4", "3 3 40 4", "3 3 4 4"],
    results: ["pass import()", "pass require()"],
  };
  await expectCompiledToRunAsPlain(expected, {
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
  const compiled = await runTests(String(dir), ["--debug-aot"]);
  expect(compiled.ended).toEqual({ printed: ["3 3"], results: ["pass replaced"], stderr: "", exitCode: 0 });
  expect(compiled.build).toEqual(oneLoad);
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
    const plain = await runTests(String(dir), flags);
    expect(plain.ended).toEqual({ printed: [], results: ["pass spies", "pass mock"], stderr: "", exitCode: 0 });
    const compiled = await runTests(String(dir), ["--debug-aot", ...flags], words);
    expect(compiled.ended).toEqual(plain.ended);
    expect(compiled.build.loads).toBe(loads);
  });

test("a tsconfig.json in a package's own folder does not decide whether its exports can be replaced", async () => {
  const expected = {
    printed: ["spied! spied !", "real1real", "real", "mocked"],
    results: ["pass a spy", "pass restored", "pass a mock"],
  };
  await expectCompiledToRunAsPlain(expected, {
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
