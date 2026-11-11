import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const sources = {
  "package.json": JSON.stringify({ name: "points", version: "1.0.0", type: "module", main: "index.js" }),
  "index.js": `import { clamp } from "./clamp.js";
/**
 * @typedef {{ x: number, y: number }} Point
 */
/**
 * The distance between two points.
 * @param {Point} a
 * @param {Point} b
 */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function scale(point, factor = 2) {
  return { x: point.x * factor, y: point.y * factor };
}
export class Counter {
  count = 0;
  constructor(step) {
    this.step = step ?? 1;
  }
  next() {
    this.count += this.step;
    return this;
  }
}
export const names = ["a", "b"];
export default function main(...values) {
  return clamp(values.length, 0, 3);
}
`,
  "clamp.js": `export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));\n`,
};

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext"],
    skipLibCheck: false,
    noEmit: true,
  },
});

describe.concurrent("bun compile --library with JavaScript sources", () => {
  test("infers the declaration files, and reads JSDoc", async () => {
    using dir = tempDir("library-javascript", sources);
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    const dist = join(String(dir), "dist");
    expect(readdirSync(dist).sort()).toEqual(["clamp.d.ts", "index.d.ts", "index.js", "package.json"]);
    const declarations = readFileSync(join(dist, "index.d.ts"), "utf8");
    expect(declarations).toContain("export type Point = {\n    x: number;\n    y: number;\n};");
    expect(declarations).toContain("export declare function distance(a: Point, b: Point): number;");
    expect(declarations).toContain(
      "export declare function scale(point: any, factor?: number): {\n    x: number;\n    y: number;\n};",
    );
    expect(declarations).toContain("    step: any;\n    count: number;\n");
    expect(declarations).toContain("export declare const names: string[];");
    expect(JSON.parse(readFileSync(join(dist, "package.json"), "utf8")).exports).toEqual({
      ".": { types: "./index.d.ts", default: "./index.js" },
      "./package.json": "./package.json",
    });
  });

  test("--format=cjs: CommonJS sources stay CommonJS", async () => {
    using dir = tempDir("library-commonjs", {
      "library/package.json": JSON.stringify({ name: "twice", version: "1.0.0", main: "index.js" }),
      "library/index.js": `const { same } = require("./same");\n/** @param {number} n */\nmodule.exports = function twice(n) {\n  return same(n) * 2;\n};\n`,
      "library/same.js": `exports.same = function (n) {\n  return n;\n};\n`,
      "app/tsconfig.json": tsconfig,
      "app/app.ts": `import twice = require("twice");\nexport const result: number = twice(21);\nexport const wrong: string = twice(1);\n`,
      "app/run.cjs": `console.log(require("twice")(21));\n`,
    });
    const built = await bun(
      join(String(dir), "library"),
      "compile",
      "--library",
      "--format=cjs",
      "--outdir",
      "../app/node_modules/twice",
    );
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    const installed = join(String(dir), "app/node_modules/twice");
    expect(JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))).toEqual({
      name: "twice",
      version: "1.0.0",
      type: "commonjs",
      main: "./index.js",
      types: "./index.d.ts",
      exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./package.json": "./package.json" },
      files: ["index.d.ts", "index.js", "same.d.ts"],
    });
    expect(readFileSync(join(installed, "index.d.ts"), "utf8")).toContain("export = twice;");
    expect(await bun(join(String(dir), "app"), "run.cjs")).toEqual({ stdout: "42\n", stderr: "", exitCode: 0 });
    const options = { ...JSON.parse(tsconfig).compilerOptions, module: "nodenext", moduleResolution: "nodenext" };
    await Bun.write(join(String(dir), "app/tsconfig.json"), JSON.stringify({ compilerOptions: options }));
    await Bun.write(join(String(dir), "app/package.json"), JSON.stringify({ name: "app", type: "commonjs" }));
    for (const check of [["check"], [require.resolve("typescript/bin/tsc")]]) {
      const { stdout, stderr, exitCode } = await bun(join(String(dir), "app"), ...check, "-p", "tsconfig.json");
      expect({ said: (stdout + stderr).match(/TS\d+/g), failed: exitCode !== 0 }).toEqual({
        said: ["TS2322"],
        failed: true,
      });
    }
  });

  test("what it writes is accepted by bun check and by tsc", async () => {
    using dir = tempDir("library-javascript-checked", {
      ...Object.fromEntries(Object.entries(sources).map(([path, text]) => ["library/" + path, text])),
      "app/tsconfig.json": tsconfig,
      "app/app.ts": `import main, { Counter, distance, names, type Point } from "points";
const origin: Point = { x: 0, y: 0 };
export const results: [number, number, number, string] = [main(1, 2), distance(origin, { x: 3, y: 4 }), new Counter(2).next().count, names[0]!];
export const wrong: string = distance(origin, origin);
`,
    });
    const built = await bun(
      join(String(dir), "library"),
      "compile",
      "--library",
      "--outdir",
      "../app/node_modules/points",
    );
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    for (const check of [["check"], [require.resolve("typescript/bin/tsc")]]) {
      const { stdout, stderr, exitCode } = await bun(join(String(dir), "app"), ...check, "-p", "tsconfig.json");
      expect({ said: (stdout + stderr).match(/TS\d+/g), failed: exitCode !== 0 }).toEqual({
        said: ["TS2322"],
        failed: true,
      });
    }
  });
});
