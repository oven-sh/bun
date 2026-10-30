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

type Part = readonly [title: string, text: string, what: string, place: string];

/** The texts are one program, one below the other, with one report. The place of a row is written as if its text were the whole program. */
function eachPart(
  parts: Part[],
  ask: (asked: Awaited<ReturnType<typeof report>>, what: string, place: string) => void,
  files?: Record<string, string>,
  command?: string[],
) {
  let asked: ReturnType<typeof report> | undefined;
  test.each(parts.map(([title], index) => [title, index] as const))("%s", async (_, index) => {
    asked ??= report(parts.map(([, text]) => text).join("\n"), files, command);
    const linesAbove = parts.slice(0, index).reduce((lines, [, text]) => lines + text.split("\n").length, 0);
    const [, , what, place] = parts[index];
    const [line, column] = place.split(":").map(Number);
    ask(await asked, what, `main.ts:${line === 1 ? 1 : line + linesAbove}:${column}`);
  });
}

describe.concurrent("a way for unseen code to run has its place in the program", () => {
  const isListed: Parameters<typeof eachPart>[1] = ({ whyOpen }, why, place) => {
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
      ],
      [
        "vm.compileFunction",
        `import { compileFunction } from "node:vm";\ncompileFunction(process.argv[2]);`,
        `${runsOtherCode} (%NodeVMBinding%.compileFunction)`,
        "3:1",
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
      ],
      [
        "dlopen of bun:ffi",
        `import { dlopen } from "bun:ffi";\ndlopen(process.argv[2], {});`,
        `${loadsMachineCode} (bun:ffi.dlopen)`,
        "3:1",
      ],
      [
        "cc of bun:ffi",
        `import { cc } from "bun:ffi";\ncc({ source: process.argv[2], symbols: {} });`,
        `${loadsMachineCode} (bun:ffi.cc)`,
        "3:1",
      ],
      ["a native addon that is required", `require("./hello.node");`, `${loadsMachineCode} (process.dlopen)`, "2:1"],
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

  test("require under another name", async () => {
    expect(
      (await report(`function load(from) {\n  return from(process.argv[2]);\n}\nload(require);`)).whyOpen,
    ).toContain(`${loadsByName} (%ModuleRequire%) at main.ts:3:10`);
  });

  // A Worker has a global of its own and starts with an entry point of the build: nothing comes to run in this program.
  test("a call in a dependency has its place there, and a Worker from a computed path lets no code in", async () => {
    const files = {
      "node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
      "node_modules/dep/index.js": `exports.make = function (text) {\n  return new Function(text);\n};\n`,
    };
    const text = `import { make } from "dep";\nmake(process.argv[2]);\nconst worker = new Worker(process.argv[2]);\nconsole.log(worker);`;
    expect((await report(text, files)).whyOpen).toEqual([
      `${evaluates} (Function) at node_modules/dep/index.js:2:14`,
      `${loadsByName} (Function) at node_modules/dep/index.js:2:14`,
    ]);
  });

  test("evaluated text imports by name, and no statement of the program does: that line has the place of the evaluator", async () => {
    expect((await report(`new Function(process.argv[2]);`)).whyOpen).toEqual([
      `${evaluates} (Function) at main.ts:2:5`,
      `${loadsByName} (Function) at main.ts:2:5`,
    ]);
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
      ({ lines }, api, place) => expect(kept(lines, api)).toContain(`used (${api}) at ${place}`),
    );

    test("a require, and an API that only one of Bun's own modules names has the statement of the program that leads there", async () => {
      const { lines } = await report(
        `console.log(require("bun:sqlite").Database.name);\nimport { createSocket } from "node:dgram";\ncreateSocket("udp4");`,
      );
      expect(kept(lines, "bun:sqlite")).toContain("used (bun:sqlite) at main.ts:2:13");
      const places = lines
        .filter(line => line.startsWith("kept ") && / at \S+:\d+:\d+$/.test(line))
        .map(line => line.slice(line.lastIndexOf(" at ") + 4));
      expect(places.filter(place => place.startsWith("main.ts:4:"))).not.toBeEmpty();
      expect(places.filter(place => !place.startsWith("main.ts:"))).toEqual([]);
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
