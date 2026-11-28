// While a loop is analyzed, the type of a value that is made from the one in front of it is found by finding that one's first: a level of recursion for each
// statement. Where three quarters of the stack are in use the innermost value is found first, from the bottom, and the walk starts over: each statement of a
// loop of 3,000 went down the whole chain anew, and TypeScript has a stack that grows.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = (
  declared: string,
  made: string,
  size: number,
) => `declare const n: number; declare function id<T>(x: T): T;
declare function over(x: string): number; declare function over(x: number): string; declare function over(x: unknown): boolean;
export function f() {
  let a${declared};
  for (let i = 0; i < n; i++) {
${`    a = ${made};\n`.repeat(size)}  }
  const z: never = a;
}
`;

// The errors are those of TypeScript 7.0.2.
describe.each([
  ["lists", " = []", "a.concat([i]).slice(0, 3)", ["(4,7) TS7034", "(6,9) TS7005"]],
  ["overloads", "", "over(a)", []],
  ["what generics return", " = []", "id(a).slice(1)", ["(4,7) TS7034", "(6,12) TS7005"]],
])("%s", (_, declared, made, errors) => {
  test.concurrent.each([10, 4000])("%d values that are made of one another in one loop", async size => {
    using dir = tempDir("check-values-made-in-one-loop", {
      "tsconfig.json": tsconfig,
      "main.ts": program(declared, made, size),
    });
    const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
    const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
    expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual([...errors, `(${size + 7},9) TS2322`]);
    expect(stdout + stderr).not.toContain("ran out of stack");
  });
});
