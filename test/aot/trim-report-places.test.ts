// --explain=trim says where: each way in which code that the compiler has not seen can come to run has a `blocked by` line with the place in the program,
// each feature that is kept because the program uses it has the place where the program names the API, and so has a locale that is no constant.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const build = ["build", "--compile", "--aot", "--outfile", "main"];
const evaluates = "eval: the program calls eval() or new Function()";
const loadsByName = "dynamic-import: the program calls import() or require() with a dynamic path";
const runsOtherCode = "runtime-code: the program can run code that isn't in the executable";
const loadsMachineCode = "native-code: the program loads a native addon or a shared library";
const importsFromOutside = "external-import: the program imports a module that isn't in the executable";
const seesEveryApi = "the compiler can see every API this program uses";

// The text of a program starts in line 2.
async function report(text: string, files: Record<string, string> = {}, command = ["check", "--aot", "--no-pretty"]) {
  using dir = tempDir("aot-trim-report-places", { "main.ts": "// @ts-nocheck\n" + text, ...files });
  const { stderr } = await run([bunExe(), ...command, "--explain=trim", "main.ts"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  const prefix = "aot: trim: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  return {
    lines,
    whyOpen: lines.filter(line => line.startsWith("blocked by ")).map(line => line.slice("blocked by ".length)),
  };
}

/** A fifth word: the report does not say the place of the row yet. It is what stands behind the line today: "" where the line has no place. */
type Part = readonly [title: string, text: string, what: string, place: string, today?: string];

/**
 * The texts are one program, one below the other, with one report. The place of a row is written as if its text were the whole program.
 * A row that is not met yet is asked all the same, and fails once it is met. A case beside it holds what the report says today.
 */
function eachPart(
  parts: Part[],
  ask: (asked: Awaited<ReturnType<typeof report>>, what: string, place: string, today?: string) => void,
  files?: Record<string, string>,
  command?: string[],
) {
  let asked: ReturnType<typeof report> | undefined;
  for (const [index, [title, , what, place, today]] of parts.entries()) {
    const asks = (saidToday?: string) => async () => {
      asked ??= report(parts.map(([, text]) => text).join("\n"), files, command);
      const linesAbove = parts.slice(0, index).reduce((lines, [, text]) => lines + text.split("\n").length, 0);
      const [line, column] = place.split(":").map(Number);
      ask(await asked, what, `main.ts:${line === 1 ? 1 : line + linesAbove}:${column}`, saidToday);
    };
    if (today === undefined) {
      test(title, asks());
      continue;
    }
    const said = today === "" ? "the line has no place" : `the line ends in "${today}"`;
    test.failing(`${title}: the place ${place} of its text is not said yet: ${said}`, asks());
    test(`${title}: what the report says today`, asks(today));
  }
}

// Bun's own tests build without the library for speed. What is written in JavaScript then runs from its text, in the interpreter, so --trim may cut neither.
describe.concurrent("a built-in function that is written in JavaScript, in a build that leaves the library out", () => {
  const source = "the source code of built-in functions (interpreter)";
  const interpreter = "eval, new Function and the JavaScript interpreter (interpreter)";
  const said = async (text: string, ...flags: string[]) =>
    (await report(text, {}, [...build, ...flags])).lines
      .filter(line => line.includes(source) || line.includes(interpreter))
      .map(line => line.replace(/: used .*/, ": used"))
      .sort();
  const maps = `console.log([1, 2, 3].map(x => x * 2).join());`;

  test("keeps its text and the interpreter", async () => {
    const both = [`kept ${interpreter}: used`, `kept ${source}: used`];
    expect(await said(maps, "--no-builtin-modules")).toEqual(both);
    expect(await said(`Blob.prototype.image.call({});`, "--no-builtin-modules")).toEqual(both);
  });

  test("keeps neither where the build holds the library, nor does a program that calls none", async () => {
    const neither = [`removed ${interpreter}: unused`, `removed ${source}: unused`];
    expect(await said(maps)).toEqual(neither);
    expect(await said(`console.log("hello");`, "--no-builtin-modules")).toEqual(neither);
  });
});

describe.concurrent("a way for unseen code to run has its place in the program", () => {
  const isListed: Parameters<typeof eachPart>[1] = ({ whyOpen }, why, place, today) => {
    if (today !== undefined) {
      const said = whyOpen.filter(line => line === why || line.startsWith(`${why} at `));
      expect(said).toEqual([why + today]);
      return;
    }
    expect(whyOpen).toContain(`${why} at ${place}`);
    expect(whyOpen.filter(why => / at (node|bun|internal)[:/]/.test(why))).toEqual([]);
  };

  // Each call has a line.
  eachPart(
    [
      ["a direct eval", `eval(process.argv[2]);`, evaluates, "2:1"],
      ["an indirect eval", `(0, eval)(process.argv[2]);`, `${evaluates} (eval)`, "2:5"],
      ["eval under another name", `const run = eval;\nrun(process.argv[2]);`, `${evaluates} (eval)`, "3:1"],
      ["new Function", `new Function(process.argv[2]);`, `${evaluates} (Function)`, "2:5"],
      ["a call of Function", `Function(process.argv[2]);`, `${evaluates} (Function)`, "2:1"],
      ["the constructor of a function", `(() => {}).constructor(process.argv[2]);`, `${evaluates} (Function)`, "2:12"],
      [
        "the constructor of async functions",
        `const make = (async () => {}).constructor;\nmake(process.argv[2]);`,
        `${evaluates} (%AsyncFunction%)`,
        "3:1",
        "",
      ],
      ["a computed require", `require(process.argv[2]);`, loadsByName, "2:1"],
      ["a computed import", `await import(process.argv[2]);`, loadsByName, "2:7"],
      [
        "process.getBuiltinModule of a computed name",
        `process.getBuiltinModule(process.argv[2]);`,
        `${loadsByName} (process.getBuiltinModule)`,
        "2:9",
      ],
      [
        "process.dlopen",
        `process.dlopen({ exports: {} }, process.argv[2]);`,
        `${loadsMachineCode} (process.dlopen)`,
        "2:9",
      ],
      ["Bun.plugin", `Bun.plugin({ name: "p", setup() {} });`, `${runsOtherCode} (Bun.plugin)`, "2:5"],
      [
        "new vm.Script",
        `import { Script } from "node:vm";\nnew Script(process.argv[2]);`,
        `${runsOtherCode} (%NodeVMBinding%.Script)`,
        "3:5",
        "",
      ],
      [
        "vm.compileFunction",
        `import { compileFunction } from "node:vm";\ncompileFunction(process.argv[2]);`,
        `${runsOtherCode} (%NodeVMBinding%.compileFunction)`,
        "3:1",
        "",
      ],
    ],
    isListed,
  );

  // Where a built-in calls it, or one of Bun's own modules: the statement of the program that leads there, if the program has no call of its own.
  eachPart(
    [
      ["eval that a promise calls", `Promise.resolve(process.argv[2]).then(eval);`, `${evaluates} (eval)`, "2:39"],
      [
        "Function that Reflect.construct calls",
        `Reflect.construct(Function, [process.argv[2]]);`,
        `${evaluates} (Function)`,
        "2:19",
      ],
      [
        "vm.runInThisContext",
        `import vm from "node:vm";\nvm.runInThisContext(process.argv[2]);`,
        `${runsOtherCode} (%NodeVMBinding%.Script)`,
        "3:4",
        "",
      ],
      [
        "dlopen of bun:ffi",
        `import { dlopen } from "bun:ffi";\ndlopen(process.argv[2], {});`,
        `${loadsMachineCode} (bun:ffi.dlopen)`,
        "3:1",
        "",
      ],
      [
        "cc of bun:ffi",
        `import { cc } from "bun:ffi";\ncc({ source: process.argv[2], symbols: {} });`,
        `${loadsMachineCode} (bun:ffi.cc)`,
        "3:1",
        "",
      ],
      [
        "a native addon that is required",
        `require("./hello.node");`,
        `${loadsMachineCode} (process.dlopen)`,
        "2:1",
        " at hello.node:1:1",
      ],
    ],
    isListed,
    { "hello.node": "no addon" },
  );

  eachPart(
    [
      ["eval that is bound", `queueMicrotask(eval.bind(null, process.argv[2]));`, `${evaluates} (eval)`, "2:16"],
      ["Function that apply calls", `Function.apply(null, [process.argv[2]]);`, `${evaluates} (Function)`, "2:1"],
      [
        "vm.runInNewContext of what require answers",
        `require("node:vm").runInNewContext(process.argv[2]);`,
        `${runsOtherCode} (%NodeVMBinding%.Script)`,
        "2:20",
        "",
      ],
    ],
    isListed,
  );

  eachPart(
    [
      [
        "a package that is marked --external and is imported",
        `import value from "outside";\nconsole.log(value);`,
        "",
        "3:13",
      ],
      ["a package that is marked --external and is required", `console.log(require("outside"));`, "", "2:13"],
      [
        "a package that is marked --external and is loaded by import()",
        `console.log(await import("outside"));`,
        "",
        "2:19",
      ],
    ],
    ({ whyOpen }, _, place) => expect(whyOpen).toContain(`${importsFromOutside} at ${place}`),
    {},
    // Code from outside may load any of Bun's own modules, and compiling them all takes ten times as long as everything else here.
    [...build, "--no-builtin-modules", "--external", "outside"],
  );

  test("under --trim what only a text from run time can name is removed, with the place of the text and how to keep it", async () => {
    const text = `new Function(process.argv[2])();`;
    const removed =
      "removed Bun.color (color): no code names it, but a name from run time could reach it (Bun.color) at main.ts:2:5. " +
      'To keep it, add "color" to compile.trim.allow';
    const { lines } = await report(text);
    expect(lines).toContain(removed);
    expect(lines).toContain(
      "the compiler can't tell which API this program uses at main.ts:2:5, because the name is only known at run time",
    );
    // A build that writes an executable without --trim is compiled as ever: its report still counts such names, and says so.
    const withoutTrim = (await report(text, {}, build)).lines;
    expect(withoutTrim).not.toContain(removed);
    expect(withoutTrim).toContain(
      "without --trim this report keeps what only a name from run time could reach; --trim removes it",
    );
  });

  // Not met yet: the place is where `require` is handed on, not where it is called.
  const underAnotherName = `function load(from) {\n  return from(process.argv[2]);\n}\nload(require);`;
  test.failing(
    "require under another name: the place 3:10 of the call is not said yet: the line ends in 5:6",
    async () => {
      expect((await report(underAnotherName)).whyOpen).toContain(`${loadsByName} (%ModuleRequire%) at main.ts:3:10`);
    },
  );
  test("require under another name: what the report says today", async () => {
    expect((await report(underAnotherName)).whyOpen).toContain(`${loadsByName} (%ModuleRequire%) at main.ts:5:6`);
  });

  // A Worker has a global of its own: nothing comes to run in this program. What it starts from may be text, which runs beside it.
  test("a call in a dependency has its place there, and so has a Worker from a computed path", async () => {
    const files = {
      "node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
      "node_modules/dep/index.js": `exports.make = function (text) {\n  return new Function(text);\n};\n`,
    };
    const text = `import { make } from "dep";\nmake(process.argv[2]);\nconst worker = new Worker(process.argv[2]);\nconsole.log(worker);`;
    expect((await report(text, files)).whyOpen).toEqual([
      `${evaluates} (Function) at node_modules/dep/index.js:2:14`,
      `${loadsByName} (Function) at node_modules/dep/index.js:2:14`,
      "dynamic-import: the program starts a Worker from code that isn't in the executable (Worker) at main.ts:4:20",
    ]);
  });

  test("evaluated text imports by name, and no statement of the program does: that line has the place of the evaluator", async () => {
    expect((await report(`new Function(process.argv[2]);`)).whyOpen).toEqual([
      `${evaluates} (Function) at main.ts:2:5`,
      `${loadsByName} (Function) at main.ts:2:5`,
    ]);
  });

  // A symbol can name no member of the table: `eval`, `Function` and `Bun` all have names that are texts. Not met yet: the
  // compiler takes a read or a store under a symbol on a built-in object for one under a name that is only known at run time.
  const underRegisteredSymbol = `const SLOT = Symbol.for("app.slot");\nconst slots = globalThis as unknown as Record<symbol, { count: number } | undefined>;\nconsole.log((slots[SLOT] ??= { count: 0 }).count);`;
  const underCreatedSymbol = `const SLOT = Symbol("app.slot");\nconst slots = globalThis as unknown as Record<symbol, number | undefined>;\nslots[SLOT] = 1;\nconsole.log(slots[SLOT]);`;
  const underSymbolHeldInConstant = `const tag = Symbol.toStringTag;\n(globalThis as Record<symbol, string>)[tag] = "app";\nconsole.log(String(globalThis));`;
  for (const [title, text] of [
    ["a slot of globalThis under a registered symbol", underRegisteredSymbol],
    ["a slot of globalThis under a symbol made once", underCreatedSymbol],
    ["a store on globalThis under a well-known symbol held in a constant", underSymbolHeldInConstant],
  ] as const) {
    test.failing(`${title} names no API of the program: not yet: the symbol counts as a name from run time`, async () => {
      const { lines, whyOpen } = await report(text);
      expect(whyOpen).toEqual([]);
      expect(lines[0]).toBe(seesEveryApi);
    });
  }
  test("a slot of globalThis under a registered symbol: what the report says today", async () => {
    const { whyOpen } = await report(underRegisteredSymbol);
    expect(whyOpen).toContain(`${evaluates} (Function) at main.ts:4:14`);
    expect(whyOpen).toContain(`${evaluates} (eval) at main.ts:4:14`);
  });
  test("a store on globalThis under a well-known symbol held in a constant: what the report says today", async () => {
    expect((await report(underSymbolHeldInConstant)).whyOpen).toEqual([`${evaluates} (Function)`, loadsByName]);
  });
  // A key that is one of two symbols, or a symbol that a loop makes anew, is a name from run time all the same.
  test("a slot of globalThis under one of two symbols is a name from run time", async () => {
    const { lines, whyOpen } = await report(
      `const a = Symbol("a"), b = Symbol("b");\nconst slots = globalThis as unknown as Record<symbol, number>;\nconsole.log(slots[process.argv.length > 2 ? a : b]);`,
    );
    expect(whyOpen).toContain(`${evaluates} (Function) at main.ts:4:13`);
    expect(lines).not.toContain(seesEveryApi);
  });

  // A function written without "use strict" that unseen code may call has the global object for `this` where the caller left the
  // receiver out, beside whatever else the caller gave. A read through it hands nothing out. Not met yet: the join loses the global
  // object, so every global is in reach, and the two lines have no place, because no call of the program made the loss.
  const sloppyThis = {
    "m.cjs": `const errors = { A: "a" };\nfor (const msg of Object.keys(errors)) exports[msg] = () => new Error(errors[msg]);\nexports.h = { toString: function () { return JSON.stringify(this); } };\n`,
  };
  const requiresSloppyThis = `const M = require("./m.cjs");\nconsole.log(typeof M.h);`;
  test.failing(
    "a sloppy function on an object that unseen code may call reads `this`: no unseen code can run: not yet: the global object is lost at the join",
    async () => {
      const { lines, whyOpen } = await report(requiresSloppyThis, sloppyThis);
      expect(whyOpen).toEqual([]);
      expect(lines[0]).toBe(seesEveryApi);
    },
  );
  test("a sloppy function on an object that unseen code may call reads `this`: what the report says today", async () => {
    expect((await report(requiresSloppyThis, sloppyThis)).whyOpen).toEqual([`${evaluates} (Function)`, loadsByName]);
  });
});

describe.concurrent(
  "a feature that is kept because the program uses it has the place where the program names the API",
  () => {
    const kept = (lines: string[], api: string) =>
      lines
        .filter(line => line.startsWith("kept ") && line.includes(`: used (${api})`))
        .map(line => line.slice(line.indexOf(": used") + 2));

    eachPart(
      [
        ["a call", `Bun.serve({ port: 0, fetch: () => new Response("") });`, "Bun.serve", "2:1"],
        [
          "a method of a primitive",
          `const price = 1234.5;\nconsole.log(price.toLocaleString("de"));`,
          "Number.prototype.toLocaleString",
          "3:13",
        ],
        ["a construction", `console.log(new Bun.Glob("*.ts").match("a.ts"));`, "Bun.Glob", "2:17"],
        [
          "an import",
          `import { Database } from "bun:sqlite";\nconsole.log(new Database(":memory:").filename);`,
          "bun:sqlite",
          "1:1",
        ],
        [
          "the first of two",
          `function late() {\n  return Bun.hash("b");\n}\nconsole.log(Bun.hash("a"), late());`,
          "Bun.hash",
          "3:10",
        ],
      ],
      ({ lines }, api, place, today) =>
        today === undefined
          ? expect(kept(lines, api)).toContain(`used (${api}) at ${place}`)
          : expect(kept(lines, api)).toEqual([`used (${api})${today}`]),
    );

    const requiresAndImports = `console.log(require("bun:sqlite").Database.name);\nimport { createSocket } from "node:dgram";\ncreateSocket("udp4");`;
    const placesOfKept = (lines: string[]) =>
      lines
        .filter(line => line.startsWith("kept ") && / at \S+:\d+:\d+$/.test(line))
        .map(line => line.slice(line.lastIndexOf(" at ") + 4));
    test("a require", async () => {
      expect(kept((await report(requiresAndImports)).lines, "bun:sqlite")).toContain(
        "used (bun:sqlite) at main.ts:2:13",
      );
    });
    test.failing(
      "an API that only one of Bun's own modules names has the statement of the program that leads there: not yet: no line names line 4, and some name places in Bun's own modules",
      async () => {
        const places = placesOfKept((await report(requiresAndImports)).lines);
        expect(places.filter(place => place.startsWith("main.ts:4:"))).not.toBeEmpty();
        expect(places.filter(place => !place.startsWith("main.ts:"))).toEqual([]);
      },
    );
    test("an API that only one of Bun's own modules names: what the report says today", async () => {
      const places = placesOfKept((await report(requiresAndImports)).lines);
      expect(places.filter(place => place.startsWith("main.ts:4:"))).toEqual([]);
      expect(places.filter(place => /^(node|bun|internal):/.test(place))).not.toBeEmpty();
    });

    test("a call under a computed key has the place, what it could reach that was removed, and how to keep it; the method that the read hands out has the place of the read", async () => {
      const { lines } = await report(
        `const cookies = JSON.parse(process.argv[2]);\nconsole.log(cookies[process.argv[3]]("b"));`,
      );
      expect(kept(lines, "String.prototype.normalize")).toEqual(["used (String.prototype.normalize) at main.ts:3:13"]);
      expect(lines[0]).toBe(
        "the compiler can't tell which API this program uses at main.ts:3:13, because the name is only known at run time",
      );
      expect(lines).not.toContain(seesEveryApi);
      expect(lines).toContain(
        "removed Intl.Collator and localeCompare (intl): no code names it, but a name from run time could reach it " +
          '(String.prototype.localeCompare) at main.ts:3:13. To keep it, add "intl" to compile.trim.allow',
      );
    });

    test("a call of a number's method under a computed key", async () => {
      const { lines } = await report(`console.log((5)[process.argv[2]]());`);
      expect(lines[0]).toBe(
        "the compiler can't tell which API this program uses at main.ts:2:14, because the name is only known at run time",
      );
      expect(lines).not.toContain(seesEveryApi);
      expect(lines).toContain(
        "removed Intl.NumberFormat, Intl.DurationFormat and toLocaleString on numbers and BigInts (intl): " +
          "no code names it, but a name from run time could reach it (Number.prototype.toLocaleString) at main.ts:2:14. " +
          'To keep it, add "intl" to compile.trim.allow',
      );
    });

    // The function is there and prints its name. Nobody calls it, so what is behind it is not kept.
    test("a program that names everything it calls and only prints the method that a read under a computed key hands out", async () => {
      const { lines } = await report(
        `console.log((5).toFixed(2));\nconst cookies = JSON.parse(process.argv[2]);\nconsole.log(cookies[process.argv[3]]);`,
      );
      expect(lines[0]).toBe(seesEveryApi);
      expect(lines.filter(line => line.includes("name from run time"))).toEqual([]);
      expect(kept(lines, "String.prototype.localeCompare")).toEqual([]);
      expect(lines).toContain("removed Intl.Collator and localeCompare (intl): unused");
    });
  },
);
