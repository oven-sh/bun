// `bun run --aot` checks a program as `bun compile` does and then runs it from its sources. `bun run --debug-aot`, which is for Bun's own
// tests, compiles it as `bun compile` does and runs the compiled code without writing an executable. Either way a program that builds
// prints what it prints under `bun run`, and one that does not build does not start.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const tsconfig = (compilerOptions: object = {}) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      noEmit: true,
      types: [],
      ...compilerOptions,
    },
  });

const programs: Record<string, { entry: string; files: Record<string, string> }> = {
  "ES modules": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import fallback, { count, bump } from "./counter.mjs";
import * as all from "./counter.mjs";
import settings from "./settings.json";
bump();
const late = await import("./late.mjs");
console.log(fallback, count, Object.keys(all).join(), settings["1"], Object.keys(settings).join(), late.name);
console.log(import.meta.main, import.meta.url.split("/").at(-1), import.meta.path === process.argv[1]);
`,
      "counter.mjs": `export let count = 0;\nexport function bump() {\n  count++;\n}\nexport default "fallback";\n`,
      "late.mjs": `export const name = import.meta.main ? "main" : "late";\n`,
      "settings.json": `{ "b": 1, "1": "one", "a": 2, "0": "zero" }\n`,
    },
  },
  "CommonJS": {
    entry: "main.cjs",
    files: {
      "main.cjs": `const first = require("./first.cjs");
const path = require("node:path");
console.log(first.name, first.second.name, require.main === module, module.children.map(child => path.basename(child.filename)).join());
console.log(path.basename(__filename), path.basename(require.resolve("./second.cjs")), typeof module.parent, this === exports);
console.log(require("./data.json").list.length);
`,
      "first.cjs": `exports.name = "first";\nexports.second = require("./second.cjs");\n`,
      "second.cjs": `module.exports = { name: require.main === module ? "main" : "second" };\n`,
      "data.json": `{ "list": [1, 2, 3] }\n`,
    },
  },
  "a project with a tsconfig.json": {
    entry: "src/main.ts",
    files: {
      "tsconfig.json": tsconfig({ paths: { "@lib/*": ["./lib/*"] }, experimentalDecorators: true }),
      "src/main.ts": `import { area, Kind, type Shape } from "@lib/shapes";
import { loose } from "../loose/loose";
function logged(target: object, name: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function (this: unknown, ...values: unknown[]) {
    return name + ":" + original.apply(this, values);
  };
}
class Report {
  constructor(private readonly shapes: Shape[]) {}
  @logged total() {
    return this.shapes.reduce((sum, shape) => sum + area(shape), 0);
  }
}
console.log(new Report([{ kind: Kind.Square, side: 3 }, { kind: Kind.Circle, radius: 1 }]).total(), Kind[Kind.Circle], loose());
`,
      "lib/shapes.ts": `export enum Kind {
  Square,
  Circle,
}
export type Shape = { kind: Kind.Square; side: number } | { kind: Kind.Circle; radius: number };
export function area(shape: Shape): number {
  return shape.kind === Kind.Square ? shape.side ** 2 : Math.round(Math.PI * shape.radius ** 2);
}
`,
      "loose/tsconfig.json": tsconfig({ strict: false }),
      "loose/loose.ts": `export function loose(): number {\n  const text: string = null;\n  return text === null ? -1 : text.length;\n}\n`,
    },
  },
  "packages": {
    entry: "main.ts",
    files: {
      "tsconfig.json": tsconfig(),
      "main.ts": `import { how } from "dual";
import { typed } from "typed";
import inner from "dual/inner";
declare const require: (name: string) => { how: string };
console.log(how, require("dual").how, typed(20), inner);
`,
      "node_modules/dual/package.json": JSON.stringify({
        name: "dual",
        version: "1.0.0",
        exports: {
          ".": { types: "./index.d.ts", import: "./index.mjs", require: "./index.cjs" },
          "./inner": { types: "./inner.d.ts", default: "./lib/inner.js" },
        },
      }),
      "node_modules/dual/index.d.ts": `export const how: string;\n`,
      "node_modules/dual/index.mjs": `export const how = "imported";\n`,
      "node_modules/dual/index.cjs": `exports.how = "required";\n`,
      "node_modules/dual/inner.d.ts": `declare const inner: string;\nexport default inner;\n`,
      "node_modules/dual/lib/inner.js": `module.exports = "inner";\n`,
      "node_modules/typed/package.json": JSON.stringify({ name: "typed", version: "1.0.0", main: "index.ts" }),
      "node_modules/typed/index.ts": `export function typed(n: number): number {\n  return n + 1;\n}\n`,
    },
  },
  "a Worker": {
    entry: "main.ts",
    files: {
      "tsconfig.json": tsconfig({ lib: ["ESNext", "DOM"] }),
      "main.ts": `import { twice } from "./twice";
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
const answer = await new Promise<number>(resolve => {
  worker.onmessage = event => resolve(event.data);
  worker.postMessage(10);
});
worker.terminate();
console.log(twice(answer));
`,
      "worker.ts": `import { twice } from "./twice";
declare var self: Worker;
self.onmessage = event => postMessage(twice(event.data) + 1);
`,
      "twice.ts": `export function twice(n: number): number {\n  return n * 2;\n}\n`,
    },
  },
};

const verbose = { ...bunEnv, NO_COLOR: "1", BUN_AOT_VERBOSE: "1" };
const runsCompiledCode = (stderr: string) => stderr.includes("[aot] module: ");

describe.concurrent("bun run --aot and bun run --debug-aot", () => {
  test.each(Object.keys(programs))("%s", async name => {
    const { entry, files } = programs[name];
    using dir = tempDir("run-aot-and-debug-aot", files);
    const [plain, checked, compiled] = await Promise.all([
      run([bunExe(), "run", entry], String(dir), verbose),
      run([bunExe(), "run", "--aot", entry], String(dir), verbose),
      run([bunExe(), "run", "--debug-aot", entry], String(dir), { ...verbose, BUN_JSC_crashIfInterpreterIsUsed: "1" }),
    ]);
    expect(plain).toEqual({ stdout: expect.stringMatching(/\n$/), stderr: "", exitCode: 0 });
    expect({ ...checked, stderr: runsCompiledCode(checked.stderr) }).toEqual({ ...plain, stderr: false });
    expect({ ...compiled, stderr: runsCompiledCode(compiled.stderr) }).toEqual({ ...plain, stderr: true });
  });

  test("a program that does not build", async () => {
    using dir = tempDir("run-aot-and-debug-aot", {
      "tsconfig.json": tsconfig(),
      "main.ts": `import { size } from "./size";\nconsole.log("started", size);\n`,
      "size.ts": `export const size: number = "large";\n`,
    });
    const [plain, checked, compiled, built] = await Promise.all([
      run([bunExe(), "run", "main.ts"], String(dir), verbose),
      run([bunExe(), "run", "--aot", "main.ts"], String(dir), verbose),
      run([bunExe(), "run", "--debug-aot", "main.ts"], String(dir), verbose),
      run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "app"], String(dir), verbose),
    ]);
    expect(plain).toEqual({ stdout: "started large\n", stderr: "", exitCode: 0 });
    expect(built).toEqual({
      stdout: "",
      stderr: expect.stringMatching(/^error: TS2322: .*\n +at .*size\.ts:1:14$/m),
      exitCode: 1,
    });
    expect(checked).toEqual(built);
    expect(compiled).toEqual(built);
  });
});
