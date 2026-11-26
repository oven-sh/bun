// Which file comes to an error first, and how many messages deep, decides whether TypeScript tells it. Every file here imports every other one by way of some, so
// a check that began before the files in front of it were done told errors that those drop, and took what files behind it had found where it should look itself.
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
// In `m1.ts` the message about `[2n].map(f0)` prints what `f0` returns, and with it, deeper, the errors of `m0.ts`.
const apart = {
  "m0.ts": `import { C1, o1 } from "./m1";
import { C2, f2, o2 } from "./m2";
export const f0 = (a: number) => ({ m() { return [2n].map(f0)[0]; }, k: () => ((x: number) => C1.s())(1) });
export class K0 { m() { return ((f: (s: symbol) => void) => f)(f2); } get g() { return [2n].some(C2.s); } }
export const q0: never = { v: [2n].map(o2.m)[0] };
export class C0 { static s(a: number): number { return a; } }
export const o0 = { m() { return \`\${C0.s()}\`; }, get g() { return [2n].find(o1.m); } };
`,
  "m1.ts": `import { f0 } from "./m0";
import { C2 } from "./m2";
export const f1 = (a: number) => ({ r: () => ["a"].filter(f0) });
export const o1 = { m() { return f1({}); }, get g() { return Promise.resolve(2n).then(f0); } };
export class C1 { static s(a: number): number { return a; } }
export class K1 { m() { return [C2].map(f0); } get g() { return ["a"].filter(f0); } }
`,
  "m2.ts": `import { K0, f0, o0 } from "./m0";
import { C1 } from "./m1";
export const o2 = { m() { return new K0().m(); }, get g() { return \`\${C1.s()}\`; } };
export class C2 { static s(a: number): number { return a; } }
export const f2 = (a: number) => ({ m() { return () => f0(1); }, k: () => 1 });
export const q1: never = [[2n].map(o0.m)[0]];
export class K2 { m() { return [2n].map(o0.m)[0]; } get g() { return [2n].map(f2)[0]; } }
export const q2: never = { k: f2(1) };
`,
};

test("three files", async () => {
  const files: Record<string, string> = apart;
  using dir = tempDir("check-errors-in-one-cycle", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: Object.keys(files) }),
    ...files,
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
  expect(expected.length).toBeGreaterThan(5);
  for (let i = 0; i < 4; i++) expect(await check(2)).toEqual(expected);
  for (let i = 0; i < 4; i++) expect(await check(8)).toEqual(expected);
});
