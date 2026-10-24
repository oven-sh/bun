import { describe, expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, featureOf, withoutFeatures } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import {
  accountsFor,
  build,
  closed,
  completeness,
  external,
  open,
  retainsFeature,
  uncompiledModule,
  unseenCode,
  type Use,
} from "./runtime-use-expectations";
import { declared, of, runtimeUse, tsconfig, withDeclarations } from "./runtime-use-harness";
import { eachRow, test } from "./supported";

const usesEveryMember = (use: Use) => use.lines.includes("property toTemporalInstant");
const hello = { "main.ts": declared + `console.log("hello");` };

describe.concurrent("import name = a.b, which only TypeScript has", () => {
  const bun = `declare namespace Bun { function color(name: string, format: string): string; }\n`;
  const log = `declare const console: any;\n`;

  test.each([
    ["a member of Bun", log + bun + `import paint = Bun.color; console.log(paint("red", "hex"));`, ["Bun color"]],
    ["Bun", log + bun + `import B = Bun; console.log(B.color("red", "hex"));`, ["Bun color"]],
    [
      "a member of process",
      log +
        `declare namespace process { const report: unknown; }\nimport report = process.report; console.log(report);`,
      ["process report"],
    ],
    [
      "a global",
      log +
        `declare namespace HTMLRewriter { const one: number; }\nimport Rewriter = HTMLRewriter; console.log(Rewriter.one);`,
      ["global HTMLRewriter"],
    ],
    [
      "a member of a global",
      log + `import Format = Intl.NumberFormat; console.log(new Format("de").format(1.5));`,
      ["global Intl", "Intl NumberFormat"],
    ],
    [
      "console",
      `declare namespace console { function log(...values: unknown[]): void; }\nimport out = console; out.log(1);`,
      ["console log"],
    ],
  ])("counts as a use of %s", async (_, text, lines) => {
    const use = await runtimeUse({ "main.ts": text });
    expect(lines.filter(line => accountsFor(use, line))).toEqual(lines);
  });

  test.each([
    [
      "a namespace of the program's own with that name",
      `namespace Bun { export function color(name: string, format: string) { return name + format; } }\nimport paint = Bun.color; console.log(paint("red", "hex"));`,
    ],
    [
      "an alias for a type alone",
      bun +
        `declare namespace Bun { interface Shade { name: string } }\nimport Shade = Bun.Shade; let shade: Shade | undefined; console.log(shade);`,
    ],
  ])("is no use of Bun with %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": log + text });
    expect({
      ...completeness(use),
      ofBun: use.lines.filter(line => line.startsWith("Bun ") || line === "global Bun"),
    }).toEqual({ ...closed, ofBun: [] });
  });
});

describe.concurrent("require with a second argument", () => {
  test.each([
    ["a built-in module", `console.log(require("bun:sqlite", 0));`, "module bun:sqlite"],
    ["Bun", `console.log(require("bun", 0).color("red", "hex"));`, "Bun color"],
  ])("counts as a use of %s", async (_, text, line) => {
    expect(accountsFor(await of(text), line)).toBe(true);
  });
});

describe.concurrent("Function evaluates text however it is called", () => {
  test.each([
    ["Function.call", `console.log(Function.call(null, process.argv[2])());`],
    ["Function.apply", `console.log(Function.apply(null, [process.argv[2]])());`],
    ["Function.bind", `console.log(Function.bind(null, process.argv[2])()());`],
    ["call in brackets", `console.log((Function as any)["call"](null, process.argv[2])());`],
    ["Function.valueOf", `console.log((Function.valueOf() as any)(process.argv[2])());`],
    ["Function.constructor", `console.log(Function.constructor(process.argv[2])());`],
    ["globalThis.Function.call", `console.log(globalThis.Function.call(null, process.argv[2])());`],
    ["Reflect.apply", `console.log(Reflect.apply(Function, null, [process.argv[2]])());`],
    ["Reflect.construct", `console.log(Reflect.construct(Function, [process.argv[2]])());`],
    ["a class that extends it", `class Mine extends Function {} console.log(new Mine(process.argv[2])());`],
  ])("the report is open with %s", async (_, text) => {
    const use = await of(text);
    expect(completeness(use).whyOpen).toContain("eval: the program calls eval() or new Function() (Function)");
  });

  test.each([
    ["Function.prototype.toString", `console.log(Function.prototype.toString.call(() => 1));`],
    ["Function.prototype.call", `console.log(Function.prototype.call.call((one: number) => one, null, 1));`],
    ["Function.name and Function.length", `console.log(Function.name, Function.length);`],
    ["instanceof Function", `console.log((() => 1) instanceof Function);`],
    ["typeof Function", `console.log(typeof Function);`],
    [
      "call of a function of the program's own",
      `function mine(this: any, text: string) { return text; } console.log(mine.call(null, "return 1"));`,
    ],
    [
      "a class of the program's own with that name",
      `export {}; class Function { static call(one: any, text: string) { return text; } } console.log(Function.call(null, "return 1"));`,
    ],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

describe.concurrent(
  "with --disallow-code-generation-from-strings no string becomes code through eval or Function",
  () => {
    const withFlag = (text: string, flag = "--disallow-code-generation-from-strings") =>
      runtimeUse({ "main.ts": declared + text }, ["check", "--aot", "--no-pretty", flag]);
    const input = `const input: any = JSON.parse(process.argv[2]);\n`;

    test.each([
      ["a direct eval", `eval(process.argv[2]);\nexport {};`],
      ["an indirect eval", `(0, eval)(process.argv[2]);`],
      ["eval of the global object", `console.log((globalThis as any).eval(process.argv[2]));`],
      ["the Function constructor", `new Function(process.argv[2])();`],
      ["Function.call", `console.log(Function.call(null, process.argv[2])());`],
      ["a class that extends Function", `class Mine extends Function {} console.log(new Mine(process.argv[2])());`],
    ])("the report is closed with %s", async (_, text) => {
      const [without, use, strict] = await Promise.all([
        of(text),
        withFlag(text),
        withFlag(text, "--disallow-code-generation-from-strings=strict"),
      ]);
      expect({ isOpenWithout: without.whyOpen.length > 0, first: use.lines[0], strict: strict.lines[0] }).toEqual({
        isOpenWithout: true,
        first: closed.first,
        strict: closed.first,
      });
    });

    // The report of such a build reads like that of any closed program.
    test.todo("the report says that closed rests on the flag");

    test.each([
      ["a computed name read from what may be a function", input + `console.log(input[process.argv[3]]);`],
      ["constructor of an unknown value", input + `console.log(input.constructor("return 1"));`],
      ["eval that reaches unknown code and is called nowhere", external + `external(eval);`],
      ["the Function constructor that reaches unknown code and is called nowhere", external + `external(Function);`],
      ["Function('return this')(), whose text the compiler reads", `console.log(Function("return this")().Object);`],
      ["the names of the global object", `console.log(Object.keys(globalThis));`],
    ])("the report is closed with and without the flag with %s", async (_, text) => {
      const [without, use, strict] = await Promise.all([
        of(text),
        withFlag(text),
        withFlag(text, "--disallow-code-generation-from-strings=strict"),
      ]);
      expect({ without: without.lines[0], first: use.lines[0], strict: strict.lines[0] }).toEqual({
        without: closed.first,
        first: closed.first,
        strict: closed.first,
      });
    });

    test("the report is open with and without the flag with process.dlopen: the flag is about strings, and native code can call anything", async () => {
      const text = `process.dlopen({ exports: {} }, "./addon.node");`;
      const reports = await Promise.all([
        of(text),
        withFlag(text),
        withFlag(text, "--disallow-code-generation-from-strings=strict"),
      ]);
      const expected = open(unseenCode("process.dlopen"));
      expect(reports.map(completeness)).toEqual([expected, expected, expected]);
    });

    test.each([
      ["require of a computed name", `console.log(require(process.argv[2]));`],
      [
        "require of a computed name beside new Function",
        `try { new Function(""); } catch {}\nconsole.log(typeof require(process.argv[2]));`,
      ],
      ["import() of a computed name", `const name: string = process.argv[2]; import(name);`],
      ["node:vm", `import vm from "node:vm";\nconsole.log(vm.runInNewContext("1"));`],
    ])("the report is still open with %s", async (_, text) => {
      expect((await withFlag(text)).whyOpen).not.toEqual([]);
    });

    // A Worker has a global of its own and starts with an entry point of the build, and the report holds what every entry point uses.
    test("the report stays closed with a Worker", async () => {
      expect((await withFlag(`new Worker("./worker.ts");`)).lines[0]).toBe(closed.first);
    });

    test.each([
      [
        "node:http",
        `import http from "node:http";\nhttp.createServer((request: any, response: any) => response.end("hello")).listen(0);`,
      ],
      ["node:events", `import { EventEmitter } from "node:events";\nnew EventEmitter().emit("hello");`],
      ["node:fs", `import { readFileSync } from "node:fs";\nconsole.log(readFileSync("a").length);`],
    ])("Bun's own JavaScript in %s leaves the report closed", async (_, text) => {
      expect((await withFlag(text)).lines[0]).toBe(closed.first);
    });

    test("eval and Function are listed like other globals", async () => {
      const use = await withFlag(`(0, eval)("1"); new Function("return 1");`);
      expect({ eval: use.lines.includes("global eval"), Function: use.lines.includes("global Function") }).toEqual({
        eval: true,
        Function: true,
      });
    });

    test.each([
      "--disallow-code-generation-from-strings",
      "--disallow-code-generation-from-strings=strict",
      "--compile-exec-argv=--smol --disallow-code-generation-from-strings",
    ])("built with %s, eval leaves the report closed", async flag => {
      const files = { "main.ts": declared + `(0, eval)(process.argv[2]);` };
      const [without, use] = await Promise.all([runtimeUse(files, build), runtimeUse(files, [...build, flag])]);
      expect({ isOpenWithout: without.whyOpen.length > 0, first: use.lines[0] }).toEqual({
        isOpenWithout: true,
        first: closed.first,
      });
    });
  },
);

describe.concurrent("an object of the program's own, read by a computed key", () => {
  const key = `const key: string = process.argv[2];\n`;
  const table = `const table = { home: () => "home", about: () => "about" };\n`;
  const called = `const found = (table as any)[key];\nconsole.log(found ? found() : "none");`;
  const judged = async (text: string, entryPoint = "main.ts") => {
    const use = await runtimeUse(
      { [entryPoint]: (entryPoint.endsWith(".ts") ? declared + key : `const key = process.argv[2];\n`) + text },
      undefined,
      entryPoint,
    );
    return { usesEveryMember: usesEveryMember(use), exitCode: use.exitCode };
  };

  eachRow([
    ["the result is stored, tested and called", table + called],
    [
      "it is declared as a table of functions",
      `const table: Record<string, () => string> = { home: () => "home", "/about": () => "about" };\nconst found = table[key];\nconsole.log(found ? found() : "none");`,
    ],
    [
      "it is read inside a function",
      `${table}function run(name: string) {\n  const found = (table as any)[name];\n  return found ? found() : "none";\n}\nconsole.log(run(key));`,
    ],
    ["it has a const assertion", `const table = { home: () => "home" } as const;\n${called}`],
    ["it satisfies a type", `const table = { home: () => "home" } satisfies Record<string, () => string>;\n${called}`],
    ["the key is tested with in first", `${table}if (key in table) {\n  ${called}\n}`],
    ["the key is tested with Object.hasOwn first", `${table}if (Object.hasOwn(table, key)) {\n  ${called}\n}`],
    [
      "its keys are listed",
      `${table}console.log(Object.keys(table).join(", "), Object.getOwnPropertyNames(table).length);\n${called}`,
    ],
    [
      "its members are listed",
      `${table}for (const [name, member] of Object.entries(table)) console.log(name, member());\nconsole.log(Object.values(table).length);\n${called}`,
    ],
    ["its keys are enumerated", `${table}for (const name in table) console.log(name);\n${called}`],
    ["it is read by literal names too", `${table}console.log(typeof table.home);\n${called}`],
    ["it has methods", `const table = { home() { return "home"; } };\n${called}`],
    [
      "it is local to a function",
      `function run(name: string) {\n  const table: Record<string, () => string> = { home: () => "home" };\n  const found = table[name];\n  return found ? found() : "none";\n}\nconsole.log(run(key));`,
    ],
    [
      "it is a parameter",
      `function run(table: Record<string, () => string>) {\n  const found = table[key];\n  return found ? found() : "none";\n}\nconsole.log(run({}));`,
    ],
    [
      "its type is queried",
      `${table}type Name = keyof typeof table;\nconst found = table[key as Name];\nconsole.log(found ? found() : "none");`,
    ],
    [
      "the result or else another function is called",
      `${table}console.log(((table as any)[key] ?? (() => "none"))());`,
    ],
    ["the result is compared", `${table}console.log((table as any)[key] === undefined ? "none" : "some");\n${called}`],
    [
      "the result is compared by size",
      `const table = { low: 0, high: 2 };\nconst found = (table as any)[key] ?? 1;\nif (found > 0) console.log("some");`,
    ],
    [
      "the result is concatenated with a string",
      "const table: Record<string, string> = { red: 'r' };\nconsole.log(table[key] + 'text', `${table[key]}text`);",
    ],
    [
      "the result is added up",
      `const table = { one: 1 };\nlet sum = 0;\nsum += (table as any)[key] ?? 0;\nconsole.log(sum, -(table as any)[key], +(table as any)[key] * 2);`,
    ],
    ["the result is called in an optional call", `${table}const found = (table as any)[key];\nconsole.log(found?.());`],
    ["a variable that is never stored to holds it", `let table = { home: () => "home" };\n${called}`],
    [
      "a var that is never stored to holds it, and the result",
      `var table = { low: 1, high: 1 << 10 };\nfunction size(value: number, unit: string) {\n  var found = value / (table as any)[unit.toLowerCase()];\n  return found;\n}\nconsole.log(size(1, key));`,
    ],
    [
      "a number is stored under a key",
      `const table = {};\n(table as any)[key] = ((table as any)[key] ?? 0) + 1;\nif ((table as any)[key] > 1) console.log("again");`,
    ],
    ["a string is stored under a name", `${table}(table as any).more = "more";\n${called}`],
    ["a function is stored under a key", `${table}(table as any)[process.argv[3]] = () => "more";\n${called}`],
    [
      "a member is incremented",
      `const table = { home: 1 };\n(table as any)[process.argv[3]]++;\n--(table as any)[process.argv[3]];\n${called}`,
    ],
    ["a member is deleted", `${table}delete (table as any)[process.argv[3]];\n${called}`],
    [
      "it is an enum",
      `enum Color {\n  Red,\n  Green = 1 << 2,\n  Blue = "blue",\n}\nconsole.log(Color[key as keyof typeof Color] === Color.Red, typeof Color[process.argv.length], Color.Green);\nconst found = (Color as any)[key];\nconsole.log(found ? found() : "none");`,
    ],
    ["the result is called in place", `${table}console.log((table as any)[key]());`],
    ["the result is called in place with arguments", `${table}(table as any)[key](process.argv[3], () => 1);`],
    ["the result is called in place and awaited", `${table}console.log(await (table as any)[key]());\nexport {};`],
    ["the result is constructed in place", `${table}console.log(new (table as any)[key]());`],
    [
      "a member says this, and the result is called in place",
      `const table = { home() { return this; } };\n(table as any)[key]();`,
    ],
    ["another constant aliases it", `${table}const other: any = table;\nconsole.log(typeof other);\n${called}`],
    ["it is destructured", `${table}const { home } = table;\nconsole.log(typeof home);\n${called}`],
    ["it is spread", `${table}console.log(typeof { ...table });\n${called}`],
  ])("only the members of Object.prototype may be used where %s", async (_, text) => {
    expect(await judged(text)).toEqual({ usesEveryMember: false, exitCode: 0 });
  });

  test("only the members of Object.prototype may be used in JavaScript", async () => {
    expect(
      await judged(
        `const table = { home: () => "home" };\nconst found = table[key];\nconsole.log(found ? found() : "none");`,
        "main.mjs",
      ),
    ).toEqual({ usesEveryMember: false, exitCode: 0 });
  });

  const inherited = ["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"].map(
    name => "property " + name,
  );

  test.each([
    ["an object literal", table + called],
    [
      "an instance of a class of the program's own",
      `class Point {\n  x = 1;\n}\nconsole.log(typeof new Point()[key as keyof Point]);`,
    ],
  ])("the key may name what %s inherits from Object.prototype", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + key + text });
    expect({
      named: inherited.filter(line => use.lines.includes(line)),
      usesEveryMember: usesEveryMember(use),
    }).toEqual({ named: inherited, usesEveryMember: false });
  });

  test.each([
    [
      "an unknown value is also stored to the variable",
      `let table = { home: () => "home" };\nif (process.argv.length > 5) table = process.argv as any;\n${called}`,
    ],
    [
      "the variable is stored to through a pattern",
      `let table = { home: () => "home" };\nif (process.argv.length > 5) [table] = [process.argv as any];\n${called}`,
    ],
    [
      "a loop stores to the variable",
      `let table = { home: () => "home" };\nfor (table of [process.argv as any]);\n${called}`,
    ],
    [
      "the var is declared twice",
      `var table: any = { home: () => "home" };\nvar table: any = process.argv;\n${called}`,
    ],
    [
      "it is a parameter of a function that reaches unknown code",
      external +
        `function run(table: Record<string, () => string>) {\n  const found = table[key];\n  return found ? found() : "none";\n}\nexternal(run);`,
    ],
  ])("any member may be used where %s", async (_, text) => {
    expect(await judged(text)).toEqual({ usesEveryMember: true, exitCode: 0 });
  });

  test("a second read by a key may use the members of what the first read gives, and no others", async () => {
    const reached = ["Object keys", "Object prototype", "global Function", "property bind", "property hasOwnProperty"];
    const use = await runtimeUse({ "main.ts": declared + key + `${table}console.log((table as any)[key][key]);` });
    expect({
      reached: reached.filter(line => use.lines.includes(line)),
      usesEveryMember: usesEveryMember(use),
      exitCode: use.exitCode,
    }).toEqual({ reached, usesEveryMember: false, exitCode: 0 });
  });
});

describe.concurrent("the report of a build", () => {
  test("is closed for a program that is closed", async () => {
    const use = await runtimeUse(hello, build);
    expect({ first: use.lines[0], exitCode: use.exitCode }).toEqual({ first: closed.first, exitCode: 0 });
  });

  test.each([
    ["prints", "main.cjs", `console.log("run");`],
    ["exports an object with nothing to serve", "main.cjs", `module.exports = { value: 1 };`],
  ])("is closed for a CommonJS entry point that %s", async (_, entryPoint, text) => {
    const use = await runtimeUse({ [entryPoint]: text }, build, entryPoint);
    expect({ first: use.lines[0], exitCode: use.exitCode }).toEqual({ first: closed.first, exitCode: 0 });
  });

  test.each([
    ["stores to module.exports", `module.exports = { value: 1 };`],
    ["requires a file", `console.log(require("./other.cjs").value === 1 ? "one" : "other");`],
    ["tests whether there is a module", `if (typeof module !== "undefined" && module.exports) console.log("run");`],
    ["tests whether it is the main module", `if (require.main === module) console.log("run");`],
  ])("a CommonJS entry point that %s uses no member under a computed name", async (_, text) => {
    const use = await runtimeUse({ "main.cjs": text, "other.cjs": `exports.value = 1;` }, build, "main.cjs");
    expect({ first: use.lines[0], usesEveryMember: usesEveryMember(use), exitCode: use.exitCode }).toEqual({
      first: closed.first,
      usesEveryMember: false,
      exitCode: 0,
    });
  });

  test("lists what an executable that runs in place names", async () => {
    const use = await runtimeUse(hello, [...build, "--compile-in-place"]);
    expect({ namesConsole: use.lines.includes("global console"), exitCode: use.exitCode }).toEqual({
      namesConsole: true,
      exitCode: 0,
    });
  });

  test("a dependency that requires an external package opens the report, a dependency that is compiled does not", async () => {
    const wrapper = {
      "node_modules/wrapper/package.json": `{ "name": "wrapper", "main": "index.js" }`,
      "node_modules/wrapper/index.js": `let found;\ntry { found = require("late-package"); } catch {}\nmodule.exports = found;`,
    };
    const installed = {
      "node_modules/installed/package.json": `{ "name": "installed", "main": "index.js" }`,
      "node_modules/installed/index.js": `module.exports = { a: 1 };`,
    };
    const [late, there] = await Promise.all([
      runtimeUse(
        { "main.ts": declared + `// @ts-ignore\nimport found from "wrapper";\nconsole.log(found);`, ...wrapper },
        [...build, "--external", "late-package"],
      ),
      runtimeUse(
        { "main.ts": declared + `// @ts-ignore\nimport found from "installed";\nconsole.log(found);`, ...installed },
        [...build, "--external", "late-package"],
      ),
    ]);
    expect({ late: completeness(late).whyOpen, there: there.whyOpen }).toEqual({
      late: expect.arrayContaining([uncompiledModule]),
      there: [],
    });
  });

  test("is open beside a native addon that is the main file of a package: native code can call anything", async () => {
    const files = {
      "main.ts": `// @ts-ignore\nimport addon from "addon";\n${declared}console.log(addon);`,
      "node_modules/addon/package.json": `{ "name": "addon", "main": "./addon.node" }`,
      "node_modules/addon/addon.node": "no addon",
    };
    const use = await runtimeUse(files, build);
    expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({
      ...open(unseenCode("process.dlopen")),
      exitCode: 0,
    });
  });
});

describe.concurrent("the features that the options of a build use", () => {
  const optional = ["Interpreter", "PackageFiles", "SourceMaps", "RuntimeTranspiler", "Inspector"];
  const used = async (...flags: string[]) => {
    const use = await runtimeUse(hello, [...build, ...flags]);
    expect(use.exitCode).toBe(0);
    return optional.filter(feature => retainsFeature(use.lines, feature));
  };

  test("what the environment of any executable can ask for is always there", async () => {
    const use = await runtimeUse(hello, build);
    const always = ["Bunfig", "CliOptions", "CrashReport", "Profilers"];
    expect(always.filter(feature => retainsFeature(use.lines, feature))).toEqual(always);
  });

  test.each([
    ["", []],
    ["--no-compile-autoload-bunfig", []],
    ["--compile-autoload-package-json", ["PackageFiles"]],
    ["--compile-autoload-tsconfig", ["PackageFiles"]],
    ["--compile-exec-argv=--smol", []],
    ["--compile-exec-argv=--title 'a -b' --inspect=127.0.0.1:0 -c own.toml --smol --smol", optional],
    ["--disallow-code-generation-from-strings", []],
    ["--disallow-code-generation-from-strings=strict", []],
    ["--compile-exec-argv=--disallow-code-generation-from-strings", []],
    ["--sourcemap", ["SourceMaps"]],
  ])("%s", async (flag, features) => {
    expect(await used(...(flag ? [flag] : []))).toEqual(features);
  });

  test("--hot in the arguments of the executable is refused", async () => {
    const use = await runtimeUse(hello, [...build, "--compile-exec-argv=--hot"]);
    expect({ stderr: use.stderr, exitCode: use.exitCode }).toEqual({
      stderr: expect.stringContaining("error: --aot does not support --hot in --compile-exec-argv"),
      exitCode: 1,
    });
  });

  test("--inspect in the arguments of the executable runs code the compiler does not see", async () => {
    expect(completeness(await runtimeUse(hello, [...build, "--compile-exec-argv=--inspect=127.0.0.1:0"]))).toEqual(
      open("build-option: a build option lets the executable load code at run time"),
    );
  });
});

describe.concurrent("the scripts of a page are checked as a program of their own", () => {
  const files = {
    "main.ts":
      `// @ts-ignore\nimport page from "./index.html";\nimport { greeting } from "./shared";\n` +
      declared +
      `console.log(greeting("the server"), typeof page);`,
    "index.html": `<html><head><script type="module" src="./client.ts"></script></head><body></body></html>`,
    "client.ts": `import { greeting } from "./shared";\ndeclare const alert: any;\nalert(greeting("the browser"));`,
    "shared.ts": `export function greeting(who: string): string {\n  return "Hello, " + who;\n}`,
  };

  test.each(["1", "2", "3", "4"])("on %s threads, the report lists what the server names", async threads => {
    const use = await runtimeUse(files, undefined, undefined, { GOMAXPROCS: threads });
    expect({
      exitCode: use.exitCode,
      namesConsole: use.lines.includes("global console"),
      namesAlert: use.lines.includes("global alert"),
    }).toEqual({ exitCode: 0, namesConsole: true, namesAlert: false });
  });
});

describe.concurrent("Bun.serve for the exports of the entry point", () => {
  const server = `{ port: 0, fetch() { return new Response("served"); } }`;
  const answers = `function () { return new Response("ok"); }`;
  const otherModules = {
    "other.cjs": `exports.value = 1;\nexports.fetch = ${answers};`,
    "stores.cjs": `require("./main.cjs").fetch = ${answers};`,
  };
  const judged = async (files: Record<string, string>) => {
    const use = await runtimeUse(withDeclarations(files), build, Object.keys(files)[0]);
    return {
      serves: retainsFeature(use.lines, "Serve"),
      mayServe: use.whyOpen.length > 0 || retainsFeature(use.lines, "Serve"),
      first: use.lines[0],
      exitCode: use.exitCode,
    };
  };

  test.each([
    ["no exports", { "main.ts": `console.log("hello");` }],
    ["no exports, in JavaScript", { "main.js": `console.log("hello");` }],
    [
      "other exports",
      { "main.ts": `export const port = 3000;\nexport function fetch() { return new Response("not served"); }` },
    ],
    [
      "export * from a module that has a default export, which a star does not carry",
      { "main.ts": `export * from "./other";`, "other.ts": `export default ${server};\nexport const port = 3000;` },
    ],
    [
      "export * in a cycle",
      { "main.ts": `export * from "./other";`, "other.ts": `export * from "./main";\nexport const port = 3000;` },
    ],
    ["a CommonJS module that exports nothing", { "main.cjs": `console.log("hello");` }],
    [
      "a CommonJS module that requires a module that exports fetch",
      { "main.cjs": `console.log(require("./other.cjs").value);`, ...otherModules },
    ],
    [
      "a CommonJS module that tests whether it is the main module",
      { "main.cjs": `if (require.main === module) console.log("run");` },
    ],
    [
      "a CommonJS module that tests whether there is a module",
      { "main.cjs": `if (typeof module !== "undefined") console.log("run");` },
    ],
  ])("is not used with %s", async (_, files) => {
    expect(await judged(files)).toEqual({ serves: false, mayServe: false, first: closed.first, exitCode: 0 });
  });

  test.each([
    ["export default of an object", { "main.ts": `export default ${server};` }],
    ["export default of a variable", { "main.ts": `const config = ${server};\nexport default config;` }],
    ["export default of a promise", { "main.ts": `export default Promise.resolve(${server});` }],
    [
      "export default of an instance",
      {
        "main.ts": `class Server { port = 0; fetch() { return new Response("served"); } }\nexport default new Server();`,
      },
    ],
    ["export default of the result of a call", { "main.ts": `export default JSON.parse(process.argv[2]);` }],
    [
      "export default of a function with fetch on it",
      { "main.ts": `export default function app() {}\napp.fetch = () => new Response("served");\napp.port = 0;` },
    ],
    [
      "export default of an object with routes",
      { "main.ts": `export default { port: 0, routes: { "/files/*": { dir: "." } } };` },
    ],
    ["export { config as default }", { "main.ts": `const config = ${server};\nexport { config as default };` }],
    [
      "export { default } from",
      { "main.ts": `export { default } from "./other";`, "other.ts": `export default ${server};` },
    ],
    [
      "export { config as default } from",
      { "main.ts": `export { config as default } from "./other";`, "other.ts": `export const config = ${server};` },
    ],
    [
      "export * as default from",
      {
        "main.ts": `export * as default from "./other";`,
        "other.ts": `export const port = 0;\nexport function fetch() { return new Response("served"); }`,
      },
    ],
    ["export default, in JavaScript", { "main.js": `export default ${server};` }],
    [
      "an export named then that is a function",
      { "main.ts": `export function then(resolve: (namespace: object) => void) { resolve({ default: ${server} }); }` },
    ],
    [
      "export * from a module that exports then",
      {
        "main.ts": `export * from "./other";`,
        "other.ts": `export function then(resolve: (namespace: object) => void) { resolve({ default: ${server} }); }`,
      },
    ],
    [
      "export * from a CommonJS module",
      {
        "main.ts": `// @ts-ignore\nexport * from "./other.cjs";`,
        "other.cjs": `exports.then = function (resolve) { resolve({ default: ${server} }); };`,
      },
    ],
    ["module.exports", { "main.cjs": `module.exports = ${server};` }],
    ["exports.default", { "main.cjs": `exports.default = ${server};` }],
  ])("may be used with %s", async (_, files) => {
    expect(await judged(files)).toMatchObject({ mayServe: true, exitCode: 0 });
  });

  test.each([
    ["exports fetch", `exports.fetch = ${answers};`],
    ["exports app", `exports.app = {};`],
    ["exports then", `exports.then = function (resolve) { resolve({ default: { fetch: ${answers} } }); };`],
    ["exports a literal with fetch", `module.exports = { fetch: ${answers} };`],
    [
      "exports the result of a call",
      `function make() { return { fetch: ${answers} }; }\nconst server = make();\nmodule.exports = server;`,
    ],
    ["stores under a computed name", `exports[process.argv[2]] = ${answers};`],
    ["exports default", `module.exports.default = { fetch: ${answers} };`],
    [
      "defines a getter named default",
      `Object.defineProperty(exports, "default", { enumerable: true, get: function () { return served; } });\nconst served = { fetch: ${answers} };`,
    ],
    ["defines default", `Object.defineProperty(module.exports, "default", { value: { fetch: ${answers} } });`],
    [
      "was an ES module",
      `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = { fetch: ${answers} };`,
    ],
    [
      "was an ES module, has no default and exports fetch",
      `Object.defineProperty(exports, "__esModule", { value: true });\nexports.fetch = ${answers};`,
    ],
    ["stores through this", `this.fetch = ${answers};`],
    ["is required by a module that stores on the result", `require("./stores.cjs");`],
    ["passes its exports to Object.assign", `Object.assign(exports, { fetch: ${answers} });`],
    [
      "passes its exports to a function of its own",
      `function fill(input) { input.fetch = ${answers}; }\nfill(exports);`,
    ],
    [
      "calls a method of its exports, which stores through this",
      `exports.fill = function () { this.fetch = ${answers}; };\nexports.fill();`,
    ],
    ["aliases module", `const alias = module;\nalias.exports.fetch = ${answers};`],
    ["takes module out of a disjunction", `const alias = module || null;\nalias.exports.fetch = ${answers};`],
    ["takes module out of a conjunction", `const alias = 1 && module;\nalias.exports.fetch = ${answers};`],
    [
      "takes module out of a conditional",
      `const alias = process.argv.length ? module : null;\nalias.exports.fetch = ${answers};`,
    ],
    [
      "takes its exports out of a conjunction",
      `const alias = typeof module !== "undefined" && module.exports;\nalias.fetch = ${answers};`,
    ],
    ["takes its exports out of a disjunction", `const alias = exports || null;\nalias.fetch = ${answers};`],
    [
      "takes its exports out of a conditional",
      `const alias = process.argv.length ? exports : null;\nalias.fetch = ${answers};`,
    ],
    [
      "passes its exports to a function in a test",
      `function fill(input) { input.fetch = ${answers}; return true; }\nif (typeof module !== "undefined" && fill(module.exports)) console.log("run");`,
    ],
    [
      "stores the result of a call where it finds that there is a module",
      `function make() { return { fetch: ${answers} }; }\nif (typeof module !== "undefined" && module.exports) module.exports = make();`,
    ],
    [
      "exports fetch, and tests whether it is the main module",
      `exports.fetch = ${answers};\nif (require.main === module) console.log("run");`,
    ],
    ["exports a function with fetch on it", `module.exports = function () {};\nmodule.exports.fetch = ${answers};`],
    [
      "exports a function that it calls, which stores on itself",
      `module.exports = function self() { self.fetch = ${answers}; };\nmodule.exports();`,
    ],
    ["exports a class", `module.exports = class { static fetch() { return new Response("ok"); } };`],
    ["exports the name of a function", `function app() {}\napp.fetch = ${answers};\nmodule.exports = app;`],
    [
      "exports a function and then something else",
      `module.exports = function () {};\nmodule.exports = { fetch: ${answers} };`,
    ],
    [
      "exports the name of a function that stores on itself without its name",
      `function app() {\n  arguments.callee.fetch = ${answers};\n}\napp();\nmodule.exports = app;`,
    ],
    [
      "exports the name of a function that it constructs",
      `function App() {\n  new.target.fetch = ${answers};\n}\nnew App();\nmodule.exports = App;`,
    ],
    [
      "exports the name of a function that it passes on",
      `function app() {}\nObject.assign(app, { fetch: ${answers} });\nmodule.exports = app;`,
    ],
    [
      "exports the name of a function, a member of which it calls",
      `function app() {}\napp.fill = function () {\n  this.fetch = ${answers};\n};\napp.fill();\nmodule.exports = app;`,
    ],
    [
      "exports the name of a function that it stores to under a computed name",
      `function app() {}\napp[process.argv[2]] = ${answers};\nmodule.exports = app;`,
    ],
    [
      "exports the name of a constant that holds a function with a name of its own",
      `const app = function self() {\n  self.fetch = ${answers};\n};\napp();\nmodule.exports = app;`,
    ],
    [
      "exports the name of a variable that is stored to",
      `let app = function () {};\napp = { fetch: ${answers} };\nmodule.exports = app;`,
    ],
    [
      "exports the name of a function that another variable aliases",
      `function app() {}\nconst alias = app;\nalias.fetch = ${answers};\nmodule.exports = app;`,
    ],
    [
      "exports the name of a class",
      `class App {\n  static fetch() {\n    return new Response("ok");\n  }\n}\nmodule.exports = App;`,
    ],
    [
      "exports a function in a branch",
      `if (process.argv.length > 5) module.exports = function () {};\nelse module.exports = { fetch: ${answers} };`,
    ],
    [
      "exports a function and passes it on",
      `module.exports = function () {};\nObject.assign(module.exports, { fetch: ${answers} });`,
    ],
    ["gives its exports another prototype", `Object.setPrototypeOf(exports, { fetch: ${answers} });`],
  ])("may be used with a CommonJS entry point that %s", async (_, text) => {
    expect(await judged({ "main.cjs": text, ...otherModules })).toMatchObject({ mayServe: true, exitCode: 0 });
  });
});

describe.concurrent("what is done with the exports of the entry point does not depend on how the program runs", () => {
  async function said(cmd: string[], cwd: string) {
    const { stdout, stderr, exitCode } = await run(cmd, cwd);
    return {
      stdout: stdout.replace(/^Started (development )?server: http:\/\/localhost:\d+$/gm, "Started a server"),
      stderr,
      exitCode,
    };
  }

  const leaves = `setTimeout(() => process.exit(0), 50);`;

  test.each([
    ["no exports", { "main.ts": `console.log("hello");` }, "hello\n"],
    [
      "a server's configuration",
      { "main.ts": `export default { port: 0, fetch() { return new Response("served"); } };\n${leaves}` },
      "Started a server\n",
    ],
    [
      "a server's configuration out of another module",
      {
        "main.ts": `export { default } from "./other";\n${leaves}`,
        "other.ts": `export default { port: 0, fetch() { return new Response("served"); } };`,
      },
      "Started a server\n",
    ],
    [
      "a server's configuration that only export * reaches",
      {
        "main.ts": `export * from "./other";`,
        "other.ts": `export default { port: 0, fetch() { return new Response("served"); } };`,
      },
      "",
    ],
    [
      "a server's configuration in a CommonJS module",
      { "main.cjs": `module.exports = { port: 0, fetch() { return new Response("served"); } };\n${leaves}` },
      "Started a server\n",
    ],
    [
      "a server",
      {
        "main.ts": `const server = Bun.serve({ port: 0, fetch() { return new Response("served"); } });\nexport default server;\n${leaves}`,
      },
      "",
    ],
    ["a class", { "main.ts": `export default class Server { static fetch = "no function"; }` }, ""],
    ["the global object", { "main.ts": `export default globalThis;` }, ""],
    [
      "an object that says what is read of it",
      {
        "main.ts": `export default new Proxy({}, { get(_, name) { console.log("read", String(name)); return undefined; } });`,
      },
      "read fetch\nread app\n",
    ],
    [
      "a binding that changes while it is looked at",
      {
        "main.ts": `
          const second = { get port() { console.log("the second is served"); return 0; }, fetch() { return new Response("second"); } };
          let config = { get port() { console.log("the first is served"); return 0; }, get fetch() { config = second; return () => new Response("first"); } };
          export { config as default };
          ${leaves}
        `,
      },
      "the second is served\nStarted a server\n",
    ],
    [
      "a function named then",
      {
        "main.ts": `
          export function then(this: object, resolve: (namespace: object) => void, reject: unknown) {
            console.log("then", Object.prototype.toString.call(this), Object.keys(this).join(), reject === reportError);
            resolve({ default: { port: 0, fetch() { return new Response("served"); } } });
            ${leaves}
          }
          export default { get fetch() { console.log("the default export is not looked at"); return undefined; } };
        `,
      },
      "then [object Module] default,then true\nStarted a server\n",
    ],
  ])("%s", async (_, files, stdout) => {
    using dir = tempDir("aot-runtime-use-entry", { "tsconfig.json": tsconfig, ...withDeclarations(files) });
    const [cwd, entryPoint] = [String(dir), Object.keys(files)[0]];
    const built = await Promise.all([
      said([bunExe(), "build", "--compile", entryPoint, "--outfile", "bundled"], cwd),
      said([bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", "compiled"], cwd),
    ]);
    expect(built.map(it => ({ stderr: it.stderr, exitCode: it.exitCode }))).toEqual([
      { stderr: "", exitCode: 0 },
      { stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 },
    ]);
    const expected = { stdout, stderr: "", exitCode: 0 };
    expect(
      await Promise.all([
        said([bunExe(), entryPoint], cwd),
        said([join(cwd, "bundled")], cwd),
        said([join(cwd, "compiled")], cwd),
      ]),
    ).toEqual([expected, expected, expected]);
  });
});

describe.skipIf(!canTrim)("what --trim removes", () => {
  const main = declared + `console.log("hello");`;

  async function built(files: Record<string, string>, entryPoints = ["main.ts"]) {
    using dir = tempDir("aot-runtime-use-writer", { "tsconfig.json": tsconfig, ...files });
    const contents: string[] = [];
    for (const [folder, without] of [
      ["by-use", []],
      ["without-an-unused-feature", [featureOf("HTMLRewriter")]],
    ] as const) {
      const { stderr: buildErrors, exitCode: buildExitCode } = await run(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--trim",
          ...withoutFeatures(without),
          ...entryPoints,
          "--outfile",
          join(folder, "main"),
        ],
        String(dir),
      );
      if (buildExitCode !== 0) throw new Error(buildErrors);
      const executable = await Bun.file(
        join(String(dir), folder, process.platform === "win32" ? "main.exe" : "main"),
      ).bytes();
      contents.push(new Bun.CryptoHasher("sha256").update(executable).digest("hex"));
    }
    const { stdout, exitCode } = await run([join(String(dir), "by-use", "main")], String(dir));
    return { stdout, exitCode, removesUnusedFeatures: contents[0] === contents[1] };
  }

  test("a closed program: the features it does not use", async () => {
    expect(await built({ "main.ts": main })).toEqual({ stdout: "hello\n", exitCode: 0, removesUnusedFeatures: true });
  });

  test("a program that loads an external package: no feature for being unused", async () => {
    expect(
      await built({ "main.ts": main + `\ntry { require("late-package"); } catch {}` }, [
        "main.ts",
        "--external",
        "late-package",
      ]),
    ).toEqual({ stdout: "hello\n", exitCode: 0, removesUnusedFeatures: false });
  });

  test.each(["--smol", "--stack-trace-limit=3", "--sql-preconnect"])(
    "--compile-exec-argv=%s: the features the program does not use",
    async option => {
      expect(await built({ "main.ts": main }, ["main.ts", "--compile-exec-argv=" + option])).toEqual({
        stdout: "hello\n",
        exitCode: 0,
        removesUnusedFeatures: true,
      });
    },
  );

  test("--compile-exec-argv=--trace-exitx takes a module of the library that the image does not have: no build", async () => {
    expect(built({ "main.ts": main }, ["main.ts", "--compile-exec-argv=--trace-exitx"])).rejects.toThrow(
      "--aot does not support --trace-exitx in --compile-exec-argv",
    );
  });

  test("the script of a page runs in a browser, not here: the features the program does not use", async () => {
    const files = {
      "main.ts": `// @ts-ignore\nimport page from "./index.html";\n` + declared + `console.log(typeof page);`,
      "index.html": `<html><body><script type="module" src="./client.ts"></script></body></html>`,
      "client.ts": `export {};\n(globalThis as any).ready = 1 + 1;`,
    };
    expect(await built(files)).toEqual({ stdout: "object\n", exitCode: 0, removesUnusedFeatures: true });
  });
});
