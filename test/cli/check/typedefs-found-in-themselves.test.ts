// A type alias that only its function sees is written out in a declaration file, and where it's found again in itself its name is an error (TS4060): an object type,
// a function type and a mapped type alike. An `@typedef` isn't a type alias there: it's cut short. The errors are those of TypeScript 7.0.2.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const compilerOptions = {
  strict: true,
  noEmit: true,
  allowJs: true,
  checkJs: true,
  declaration: true,
  target: "esnext",
  lib: ["esnext"],
  types: [],
  module: "esnext",
  moduleResolution: "bundler",
};

const check = async (name: string, program: string) => {
  using dir = tempDir("check-typedefs-found-in-themselves", { "tsconfig.json": JSON.stringify({ compilerOptions }), [name]: program });
  const { stdout } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return [...stdout.matchAll(/^a\.[jt]s\((\d+,\d+)\): error (TS\d+)/gm)].map(([, at, code]) => `${at} ${code}`);
};

const inFunction = (...lines: string[]) => ["/** @param {1} x */", "export function f(x) {", ...lines, "  return y;", "}", ""].join("\n");

test.concurrent.each([
  ["an object type", inFunction("  /** @typedef {{ v: 1, n?: T }} T */", "  /** @type {T} */", "  const y = { v: x };")],
  ["an object type in parentheses", inFunction("  /** @typedef {({ v: 1, n?: T })} T */", "  /** @type {T} */", "  const y = { v: x };")],
  [
    "a list of properties",
    inFunction("  /**", "   * @typedef {object} T", "   * @property {1} v", "   * @property {T} [n]", "   */", "  /** @type {T} */", "  const y = { v: x };"),
  ],
  [
    "two that are found in each other",
    inFunction("  /** @typedef {{ v: 1, n: U[] }} T */", "  /** @typedef {{ w: T | null }} U */", "  /** @type {T} */", "  const y = { v: x, n: [] };"),
  ],
  [
    "in methods",
    "export class C {\n  m() {\n    /** @typedef {{ v: 1, n?: T }} T */\n    /** @type {T} */\n    const y = { v: 1 };\n    return y;\n  }\n}\n" +
      "export const o = { q() { /** @typedef {{ z?: Z }} Z */ /** @type {Z} */ const z = {}; return z; } };\n",
  ],
  ["what doesn't come back to itself", inFunction("  /** @typedef {{ v: 1, n?: number }} T */", "  /** @type {T} */", "  const y = { v: x };")],
])("%s", async (_, program) => {
  expect(await check("a.js", program)).toEqual([]);
});

test.concurrent.each([
  ["type T = { v: 1, n?: T };", "{ v: x }"],
  ["type T = { v: 1, n: U[] }; type U = { w: T | null };", "{ v: x, n: [] }"],
  ["type T = (n: T) => 1;", "n => x"],
  ["type T = ((n: T) => 1);", "n => x"],
  ["type T = new (n: T) => 1;", "null!"],
  ['type T = { [K in "a" | "b"]?: T };', "{}"],
  ["type Keys<K> = { [P in keyof K]?: Keys<K> }; type T = Keys<{ a: 1 }>;", "{}"],
])("in TypeScript: %s", async (types, value) => {
  expect(await check("a.ts", `export function f(x: 1) {\n  ${types}\n  const y: T = ${value};\n  return y;\n}\n`)).toEqual(["1,17 TS4060"]);
});

test.concurrent("in TypeScript, in a method, a property and a variable", async () => {
  const program =
    "export const f = (x: 1) => {\n  type T = (n: T[]) => T | null;\n  const y: T = null!;\n  return { y, z: [y] };\n};\n" +
    "export class C {\n  m() { type Q = () => Q; return null! as Q; }\n  p = (() => { type R = { r(): R }; return null! as R; })();\n}\n";
  expect(await check("a.ts", program)).toEqual(["1,14 TS4025", "7,3 TS4055", "8,3 TS4031"]);
});
