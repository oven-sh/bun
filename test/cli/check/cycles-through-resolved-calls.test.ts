// The message about a call can print a type that leads back to the call, which already has its signature. Like any cycle, the path gives its members results that depend
// on the member that was requested first. But a call hides the resolutions below it, so the checker didn't see that the path is a cycle, and it kept the results of a
// later file's check that ran first: it reported `() => ...[]` instead of `() => any`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const compilerOptions = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  lib: ["esnext"],
  types: [],
};
const implicit = (name?: string) =>
  `${name ? `error TS7023: '${name}'` : "error TS7024: Function"} implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.`;
const refused = (source: string, target: string) =>
  `error TS2345: Argument of type '${source}' is not assignable to parameter of type '${target}'.`;

// What TypeScript reports for each.
const programs: Record<string, [m0: string, m1: string, expected: string[]]> = {
  "each other's callbacks": [
    `export function f0(a: number) { return () => [2n].map(f1); }`,
    `export function f1(a: number) { return [2n].map(f0); }`,
    [
      `m0.ts(2,40): ${implicit()}`,
      `m0.ts(2,55): ${refused("(a: number) => (() => any)[]", "(value: bigint, index: number, array: bigint[]) => (() => any)[]")}`,
      `m1.ts(2,49): ${refused("(a: number) => () => any", "(value: bigint, index: number, array: bigint[]) => () => any")}`,
    ],
  ],
  "each other's callbacks, and what they return": [
    `export function f0(a: number) { return () => ["a"].map(f1)[0]; }\nexport const q0: string = f0;`,
    `export function f1(a: number) { return ["a"].map(f0)[0]; }\nexport const q1: string = f1;`,
    [
      `m0.ts(2,40): ${implicit()}`,
      `m0.ts(2,56): ${refused("(a: number) => () => any", "(value: string, index: number, array: string[]) => () => any")}`,
      `m0.ts(3,14): error TS2322: Type '(a: number) => () => any' is not assignable to type 'string'.`,
      `m1.ts(2,50): ${refused("(a: number) => () => any", "(value: string, index: number, array: string[]) => () => any")}`,
      `m1.ts(3,14): error TS2322: Type '(a: number) => () => any' is not assignable to type 'string'.`,
    ],
  ],
  "a third function between them": [
    `export function f0(a: number) { return () => [2n].map(g0)[0]; }\nexport function g0() { return ["a"].map(f1); }`,
    `export function f1(a: number) { return ["a"].map(f0); }`,
    [
      `m0.ts(2,40): ${implicit()}`,
      `m0.ts(3,17): ${implicit("g0")}`,
      `m0.ts(3,41): ${refused("(a: number) => (() => any)[]", "(value: string, index: number, array: string[]) => (() => any)[]")}`,
      `m1.ts(2,50): ${refused("(a: number) => () => any", "(value: string, index: number, array: string[]) => () => any")}`,
    ],
  ],
  "a generic function of their own": [
    `declare function call<T>(f: (a: string) => T): { r: T };\nexport function f0(a: number) { return () => [2n].map(g0)[0]; }\nexport function g0() { return call(f1); }`,
    `declare function call<T>(f: (a: string) => T): { r: T };\nexport function f1(a: number) { return call(f0); }`,
    [
      `m0.ts(3,40): ${implicit()}`,
      `m0.ts(4,17): ${implicit("g0")}`,
      `m0.ts(4,36): ${refused("(a: number) => { r: () => any; }", "(a: string) => { r: () => any; }")}`,
      `m1.ts(3,45): ${refused("(a: number) => () => any", "(a: string) => () => any")}`,
    ],
  ],
  "a promise of a method of an object": [
    `export function f0(a: number) { return () => [2n].map(o0.m)[0]; }\nexport const o0 = { m() { return Promise.resolve(2n).then(f1); } };\nexport const q0: string = f0(1);`,
    `export function f1(a: number) { return Promise.resolve(2n).then(f0); }\nexport const q1: never = [Promise.resolve(2n).then(f0)];`,
    [
      `m0.ts(2,40): ${implicit()}`,
      `m0.ts(3,21): ${implicit("m")}`,
      `m0.ts(3,59): ${refused("(a: number) => Promise<() => any>", "(value: bigint) => PromiseLike<() => any> | (() => any)")}`,
      `m0.ts(4,14): error TS2322: Type '() => any' is not assignable to type 'string'.`,
      `m1.ts(2,65): ${refused("(a: number) => () => any", "(value: bigint) => PromiseLike<() => any> | (() => any)")}`,
      `m1.ts(3,14): error TS2322: Type 'Promise<() => any>[]' is not assignable to type 'never'.`,
      `m1.ts(3,52): ${refused("(a: number) => () => any", "(value: bigint) => PromiseLike<() => any> | (() => any)")}`,
    ],
  ],
};

test.concurrent.each(Object.keys(programs))("%s", async name => {
  const [m0, m1, expected] = programs[name];
  using dir = tempDir("check-cycles-through-calls", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: ["m1.ts", "m0.ts"] }),
    "m0.ts": `import { f1 } from "./m1";\n${m0}\n`,
    "m1.ts": `import { f0 } from "./m0";\n${m1}\n`,
  });
  for (const threads of [1, 2, 2, 2, 2, 8, 8, 8, 8, 64, 64]) {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", `--threads=${threads}`, "-p", "."], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
    });
    expect(
      stdout
        .split("\n")
        .filter(line => line.includes("error TS"))
        .sort(),
    ).toEqual(expected);
  }
});
