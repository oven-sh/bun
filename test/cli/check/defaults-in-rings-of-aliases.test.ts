// An alias and the default of a type parameter that lead to each other: which of the two is told depends on the one that is asked for first. A file that asks
// first for the other told the other, if the file in front of it hadn't been checked yet.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const files = {
  "space.ts": `import {} from "./between";
export let list: [Missing<space.Q>, ..."a"] = null!;
export namespace space { export const i = [{ k: 1 }, { k: "a", j: 2 }].map(x => undefined) satisfies typeof absent; export type Q = Absent<null | "a", Ring<undefined>>; export function f(a: Unnamed) { return a; } }
export type Ring<T, D = Unknown<space.Q>> = { 1?: D };
`,
  "first.ts": `import { Ring } from "./space";
export function first(a: any, b?: any): any { return (1 as any[]) as Ring<nowhere.Q[]>; }
`,
  "between.ts": `import {} from "./first";\n`,
};
const compilerOptions = { strict: true, noEmit: true, target: "esnext", module: "esnext", moduleResolution: "bundler", lib: ["esnext"], types: [] };

// The errors of both are TypeScript 7.0.2's.
test("an alias and the default of a type parameter in one ring", async () => {
  using dir = tempDir("check-defaults-in-rings-of-aliases", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: Object.keys(files) }),
    ...files,
  });
  const check = async (threads: number) => {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", "--all", `--threads=${threads}`, "-p", "."], String(dir), { ...bunEnv, NO_COLOR: "1" });
    return stdout.match(/^space\.ts\(\d+,\d+\): error (TS2456|TS2716)/gm);
  };
  for (const threads of [1, 8, 32]) {
    const answers = await Promise.all(Array.from({ length: 16 }, () => check(threads)));
    for (const answer of answers) expect(answer).toEqual(["space.ts(4,25): error TS2716"]);
  }
});
