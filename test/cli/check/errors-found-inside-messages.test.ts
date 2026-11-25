// While a type is printed inside the message of an error that was found while a type was printed inside a message, TypeScript drops the errors that it finds.
// So whether an error in `a.ts` is told depends on which file comes there first: the first file of the program, which finds it inside one message. On two
// threads the check of `a.ts` itself came there first, inside two messages, dropped the error, and left what it had found to the check of `b.ts`, which then
// looked no further: no check told the error.
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

const places = {
  "the result of a method": (e: string) =>
    `export const o = { m() { return ${e}; } };\nexport const f2 = (a: typeof o) => o;`,
  "a function in a result": (e: string) => `export const f2 = (a: number) => ({ r: () => ${e} });`,
  "a parameter's default": (e: string) =>
    `export const f2 = (a = () => ${e}, b = C0.s(null!)) => { if (a) return { r: 1 }; return b; };`,
};
const errors = [
  ["TS2304", "nowhere"],
  ["TS2322", `((o: { r: number }) => o)({ r: "a" })`],
  ["TS2345", `C0.s("a")`],
  ["TS2554", "C0.s()"],
  ["TS2769", "C0.o(null!, 2n)"],
];

test.concurrent.each(
  errors.flatMap(([code, e]) => Object.entries(places).map(([name, place]) => [code, name, place(e)] as const)),
)("%s in %s", async (code, _, declarations) => {
  using dir = tempDir("check-errors-inside-messages", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: ["a.ts", "b.ts"] }),
    "a.ts": `import { C0, f1 } from "./b";\n${declarations}\nexport const q0: never = [f1(1)];\n`,
    "b.ts": `import { f2 } from "./a";
export class C0 {
  static s(a: number): number { return a; }
  static o(a: string, b: number): number;
  static o(a: number, b: string): string;
  static o(a: any, b: any): any { return a; }
}
export function f1(a: number) { return () => [2n].map(f2)[0]; }
`,
  });
  const check = async (threads: number) => {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", `--threads=${threads}`, "-p", "."], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
    });
    return stdout
      .split("\n")
      .filter(line => line.includes("error TS"))
      .sort();
  };
  const expected = await check(1);
  expect(expected.some(line => line.startsWith("a.ts(2,") && line.includes(code))).toBe(true);
  for (let i = 0; i < 6; i++) expect(await check(2)).toEqual(expected);
});
