// --aot proves things about a whole program only while it has seen all the code that can ever run: the program is closed.
// Only a call of an evaluator or a loader that the program can reach opens it. Mentioning a global, reading `process.env`,
// storing a property on the global object, printing an object or loading node:stream opens nothing, and the smallest of these
// programs pull in no more of Bun's own library than `console.log(1 + 2)` needs.
//
// The programs of a table are the entry points of one build, each compiled as a program of its own. The report of that build lists
// nothing under `unseenCode` only if every one of them stays closed.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { built, slot, spawned } from "./harness/commands";
import { compileCommand, withReport } from "./harness/flags";
import { describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleDetection: "force",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
});

type Programs = Record<string, { text: string; output: string }>;

const smallest: Programs = { "a sum is printed": { text: `console.log(1 + 2);\n`, output: "3\n" } };

const programs: Programs = {
  "typeof a global function": {
    text: `console.log(typeof setTimeout === "function" ? 1 : 2);\n`,
    output: "1\n",
  },
  "typeof a name that nothing defines": {
    text: `declare var window: unknown;\nconsole.log(typeof window === "undefined" ? 1 : 2);\n`,
    output: "1\n",
  },
  "a read of process.env": {
    text: `console.log(process.env.NOT_SET_ANYWHERE === undefined ? 1 : 2);\n`,
    output: "1\n",
  },
  "a store to the global object": {
    text: `declare var shared: number;\n(globalThis as any).shared = 3;\nconsole.log(shared + 1);\n`,
    output: "4\n",
  },
  "an object is printed": {
    text: `console.log({ a: 1 });\n`,
    output: "{\n  a: 1,\n}\n",
  },
  "a class of the host is printed": {
    text: `console.log(TextDecoder);\n`,
    output: "[class TextDecoder]\n",
  },
  "what is stored on the global object is constructed under its bare name": {
    text: `declare var List: ArrayConstructor;\n(globalThis as any).List = Array;\nconsole.log(new List(3).length);\n`,
    output: "3\n",
  },
};

// These need more of Bun's library than the smallest program (timers, promises, streams, the warning printer).
const programsThatNeedMoreOfTheLibrary: Programs = {
  "a function is made from a constant text with digits after a zero in a string and in a comment": {
    text: `const day = new Function("return '2024-01-08' // 010");\nconsole.log(day());\n`,
    output: "2024-01-08\n",
  },
  "a text is transpiled": {
    text: `console.log(new Bun.Transpiler({ loader: "ts" }).transformSync("const a: number = 1; console.log(a);").trim());\n`,
    output: "const a = 1;\nconsole.log(a);\n",
  },
  "a promise is settled": {
    text: `async function twice(x: number) {\n  return x * 2;\n}\ntwice(21).then(value => console.log(value));\n`,
    output: "42\n",
  },
  "a Map is filled and printed as JSON": {
    text: `const counts = new Map<string, number>();\nfor (const word of "a b a c".split(" ")) counts.set(word, (counts.get(word) ?? 0) + 1);\nconsole.log(JSON.stringify([...counts]));\n`,
    output: `[["a",2],["b",1],["c",1]]\n`,
  },
  "JSON.parse answers an object that is read": {
    text: `const point = JSON.parse('{"x":5,"y":6}') as { x: number; y: number };\nconsole.log(point.x + point.y);\n`,
    output: "11\n",
  },
  "a property of the global object under a registered symbol": {
    text: `const key = Symbol.for("app:store");\n(globalThis as any)[key] ??= { run: () => 7 };\nconsole.log((globalThis as any)[Symbol.for("app:store")].run());\n`,
    output: "7\n",
  },
  "one of a hundred functions is called": {
    text: `const choices = [${Array.from({ length: 100 }, (_, index) => `() => ${index}`).join(", ")}];\nconsole.log(choices[process.argv.length + 40]());\n`,
    output: "42\n",
  },
  "one literal spreads the bun module and the program's own options, and build is called far from there": {
    text: `import * as runtime from "bun";\nconst anything = (globalThis as any)[["Str", "ing"].join("")];\nconst withDefaults = (options: object): any => ({ verbose: false, ...options });\nconsole.log(anything(withDefaults(runtime)).length > 0);\nconst task = withDefaults({ build: () => "built" });\nconst step0 = { next: () => task.build() };\n${Array.from({ length: 7 }, (_, index) => `const step${index + 1} = { next: () => step${index}.next() };\n`).join("")}console.log(step7.next());\n`,
    output: "true\nbuilt\n",
  },
  "node:stream is loaded": {
    text: `import "node:stream";\nconsole.log(1);\n`,
    output: "1\n",
  },
  "node:net is loaded": {
    text: `import "node:net";\nconsole.log(1);\n`,
    output: "1\n",
  },
  "a stream is piped": {
    text: `import { Readable, Writable } from "node:stream";
let bytes = 0;
const sink = new Writable({
  write(chunk, _encoding, done) {
    bytes += chunk.length;
    done();
  },
});
sink.on("finish", () => console.log(bytes));
Readable.from([Buffer.from("ab"), Buffer.from("cde")]).pipe(sink);
`,
    output: "5\n",
  },
  "Math.max stands where a callback is expected": {
    text: `type Pick = (a: number, b: number) => number;
function apply(pick: Pick): number {
  return pick(1, 2);
}
const chosen: Pick = process.argv.length > 99 ? (a, b) => a - b : Math.max;
console.log(apply(chosen));
`,
    output: "2\n",
  },
};

const programsThatOpenAtOneCall: Record<string, { text: string; output: string; builtin: string; line: number }> = {
  "node:module is copied member by member, and what createRequire of the copy returns is called": {
    text: `import nodeModule from "node:module";\nconst copyOf = (source: any): any => {\n  const copy: any = {};\n  for (const key of Object.getOwnPropertyNames(source)) copy[key] = source[key];\n  return copy;\n};\nconst load = copyOf(nodeModule).createRequire(import.meta.url);\nconsole.log(typeof load(process.argv[5] ?? "node:net").Socket);\n`,
    output: "function\n",
    builtin: "%ModuleRequire%",
    line: 8,
  },
};

// The string is put together at run time, so the build can't know it.
const callOfEval = `(0, eval)(process.argv.length > 99 ? "1" : "globalThis.ranTheString = true");\nconsole.log((globalThis as any).ranTheString);\n`;

// The folder has Bun's types and not Node's.
const declarations = `declare var process: { argv: string[]; env: Record<string, string | undefined>; nextTick(callback: (...args: any[]) => void, ...args: unknown[]): void };
declare var Buffer: { from(text: string): Uint8Array };
declare module "node:net" {}
declare module "node:stream" {
  export class Writable {
    constructor(options: { write(chunk: Uint8Array, encoding: string, done: () => void): void });
    on(name: string, listener: () => void): this;
  }
  export class Readable {
    static from(items: Iterable<unknown>): Readable;
    pipe<T>(destination: T): T;
  }
}
declare module "node:events" {
  export class EventEmitter {
    on(name: string, listener: (...args: any[]) => void): this;
    emit(name: string, ...args: unknown[]): boolean;
  }
}
declare module "node:module" {
  const Module: { prototype: any; createRequire(from: string): (name: string) => any };
  export default Module;
}
`;

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

/** Builds the programs into one executable, runs each, and answers the report of the build. */
async function compileAndRun(programs: Programs) {
  const names = Object.keys(programs);
  using dir = tempDir("aot-small-programs-stay-closed", {
    ...Object.fromEntries(names.map((name, index) => [`p${index}.ts`, programs[name].text])),
    "node.d.ts": declarations,
    "tsconfig.json": tsconfig,
  });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const reportPath = join(folder, "report.json");
  built(
    await spawned(
      [
        bunExe(),
        ...compileCommand,
        "--aot-separate-programs",
        "--root=.",
        ...withReport(reportPath, "summary"),
        ...names.map((_, index) => `./p${index}.ts`),
        "--outfile",
        executable,
      ],
      folder,
      bunEnv,
    ),
  );
  // Only a canary build starts anywhere but at the first entry point.
  for (const [index, name] of (isCanary ? names : names.slice(0, 1)).entries()) {
    const ran = await spawned([executable], folder, { ...bunEnv, BUN_AOT_START_AT: `p${index}.ts` });
    expect({ name, signal: ran.signal, exitCode: ran.exitCode, stderr: ran.stderr, stdout: ran.stdout }).toEqual({
      name,
      signal: null,
      exitCode: 0,
      stderr: "",
      stdout: programs[name].output,
    });
  }
  return readBuildReport(reportPath);
}

// The analysis takes a store under one of these names through a receiver it has lost for a store into the module loader
// (`Module.wrap = ..`, `module.require = ..`), but not in Bun's own library, which stores under them only into objects it has
// made itself. Whoever adds such a store to src/js looks at its receiver first, and then adds it here.
const namesOfLoaderLocations = ["wrap", "wrapper", "require", "cache", "_cache", "_load", "_resolveFilename"];
const storesOfTheLibrary = [
  "eval/fuzzilli-reprl.ts: globalThis.require =",
  "eval/node-repl.ts: global_.require =",
  "internal/streams/readable.ts: Readable.prototype.wrap =",
  "internal/streams/readable.ts: Readable.wrap =",
];

test("the library stores under a name of the module loader only into its own objects", () => {
  const root = join(import.meta.dir, "../../src/js");
  const store = new RegExp(String.raw`[\w$.\]\[]+\.(?:${namesOfLoaderLocations.join("|")})\s*=(?!=)`, "g");
  const found = new Set<string>();
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.[jt]s$/.test(file) || file.endsWith(".d.ts") || file.includes("node_modules")) continue;
    const name = file.replaceAll("\\", "/");
    for (const [text] of readFileSync(join(root, file), "utf8").matchAll(store))
      found.add(`${name}: ${text.replace(/\s*=$/, " =")}`);
  }
  expect([...found].sort()).toEqual(storesOfTheLibrary);
});

describe.concurrent("compile/aot/small programs stay closed", () => {
  test(
    "the smallest programs, which compile about as many functions as a program that prints a sum",
    () =>
      slot(async () => {
        const [one, all] = await Promise.all([compileAndRun(smallest), compileAndRun(programs)]);
        expect({ one: one.unseenCode, all: all.unseenCode }).toEqual({ one: [], all: [] });
        // TODO: on Windows process.env is a Proxy that the library makes in JavaScript, and it brings 489 functions.
        if (isWindows) return;
        expect(all.summary.functions).toBeLessThanOrEqual(
          Object.keys(programs).length * Math.ceil(one.summary.functions * 1.25),
        );
      }),
    600_000,
  );

  test(
    "programs that need more of the library",
    () => slot(async () => expect((await compileAndRun(programsThatNeedMoreOfTheLibrary)).unseenCode).toEqual([])),
    600_000,
  );

  test(
    "a call of eval is listed where it stands",
    () =>
      slot(async () => {
        const { text, output } = programs["an object is printed"];
        const report = await compileAndRun({
          "and eval is called": { text: text + callOfEval, output: output + "true\n" },
        });
        expect(report.unseenCode).toContainEqual({
          cause: "EvaluatesText",
          builtin: "eval",
          location: expect.objectContaining({ file: expect.stringMatching(/p0\.ts$/), line: text.split("\n").length }),
        });
      }),
    600_000,
  );

  for (const [name, { text, output, builtin, line }] of Object.entries(programsThatOpenAtOneCall)) {
    test(
      name,
      () =>
        slot(async () => {
          expect((await compileAndRun({ [name]: { text, output } })).unseenCode).toEqual([
            {
              cause: "LoadsModuleByName",
              builtin,
              location: expect.objectContaining({ file: expect.stringMatching(/p0\.ts$/), line }),
            },
          ]);
        }),
      600_000,
    );
  }
});
