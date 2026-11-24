// `strs.filter(f)` in `f` doesn't need the return type of `f`. But as the argument of a generic call it's first looked at to see if it has to wait for the other
// arguments. That look entered the inner call again, and the checker took it for a cycle: it reported TS7023, and the function returned `any`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

// Each function and its return type in TypeScript. The last two are cycles.
const functions: [source: string, returned: string][] = [
  [`function f(a: string) { return id(strs.filter(f)); }`, "string[]"],
  [`function f(a: string) { return id(strs.every(f)); }`, "boolean"],
  [`function f(a: string) { return id(id(strs.filter(f))); }`, "string[]"],
  [`function f(a: string) { return [id(strs.filter(f))]; }`, "string[][]"],
  [`function f(a: string) { return new Set(strs.filter(f)); }`, "Set<string>"],
  [`function f(a: string) { return new Map([["a", strs.filter(f)]]); }`, "Map<string, string[]>"],
  [`function f(a: string) { return Promise.resolve(strs.filter(f)); }`, "Promise<string[]>"],
  [`function f(a: string) { return Promise.all([strs.filter(f), strs.some(f)]); }`, "Promise<[string[], boolean]>"],
  [`function f(a: string) { return Object.entries(strs.filter(f)); }`, "[string, string][]"],
  [`function f(a: string) { return pair(strs.filter(f), strs.find(f)); }`, "[string[], string | undefined]"],
  [`const f = (a: string) => id(strs.filter(f));`, "string[]"],
  [`const f = function (a: string) { return id(strs.filter(f)); };`, "string[]"],
  [`function f(a: string) { return id(strs.filter(x => f(x))); }`, "any"],
  [`function f(a: string) { return id(strs.map(f)); }`, "any"],
];

test("functions that pass themselves to a call in a generic call", async () => {
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] } }),
  };
  const expected: string[] = [];
  functions.forEach(([source, returned], at) => {
    const name = `f${String(at).padStart(2, "0")}.ts`;
    files[name] = `declare const strs: string[];
declare function id<T>(x: T): T;
declare function pair<A, B>(a: A, b: B): [A, B];
${source}
export const q: never = f("a");
`;
    if (returned === "any") {
      expected.push(
        `${name}(4,10): error TS7023: 'f' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.`,
      );
    }
    expected.push(`${name}(5,14): error TS2322: Type '${returned}' is not assignable to type 'never'.`);
  });
  using dir = tempDir("check-recursive-callbacks", files);
  for (const threads of [1, 8]) {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", `--threads=${threads}`, "-p", "."], String(dir), { ...bunEnv, NO_COLOR: "1" });
    expect(stdout.split("\n").filter(line => line.includes("error TS")).sort()).toEqual(expected.sort());
  }
});
