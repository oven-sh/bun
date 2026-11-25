// What a parameter's default is isn't found before something asks for the parameter's type. It was found with the signature of a call that has no argument for
// it, where a ring through it is none, and what the functions of the ring were found to be then stayed.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const head = `declare const c: boolean; declare function pair<A, B>(a: A, b: B): [A, B]; declare function over(x: string): number; declare function over(x: unknown): boolean;
`;

const programs = {
  "lists.ts": `${head}function e(k: number) { let a = []; for (let i = 0; i < k; i++) { a.push(f0(k)); } return a[0]; }
function f0(k: number) { const g = (x = f1(k)) => x; return g(); }
function f1(k: number) { let a = []; for (let i = 0; i < k; i++) { a.push(f2(k)); } return a[0]; }
function f2(k: number) { const a = over(f3(k)); return a; }
function f3(k: number) { let a: unknown = null; for (let i = 0; i < k; i++) { const t = f4(k); if (typeof t === "number") a = t; } if (k > 5) return f0(k); return f4(k); }
function f4(k: number) { return String(k); }
export const q: never = e(1); export const p: never = f0(1);
`,
  "patterns.ts": `${head}function e(k: number) { return f0(k); }
function f0(k: number) { const a = () => f1(k); return a(); }
function f1(k: number) { const g = (x = f2(k)) => x; return g(); }
function f2(k: number) { const a = []; for (const x of [k]) { const { length } = [f3(k)]; a.push(length); } return a.length ? f3(k) : null; }
function f3(k: number) { const [a, d] = pair(f4(k), k); return c ? a : d; }
function f4(k: number) { let a: unknown = null; for (let i = 0; i < k; i++) { const t = f5(k); if (typeof t === "number") a = t; } return f5(k); }
function f5(k: number) { let a = null; do { const t = f6(k); if (t === null) continue; a = t; } while (c); return a; }
function f6(k: number) { let a; for (;;) { a = f7(k); if (a) return a; if (c) break; } return null; }
function f7(k: number) { const [a, d] = pair(f8(k), k); if (k > 5) return f0(k); return c ? a : d; }
function f8(k: number) { return String(k); }
export const q: never = e(1); export const p: never = f0(1);
`,
};

// The errors are those of TypeScript 7.0.2.
const expected = {
  "lists.ts": [
    "3,10 TS7023",
    "3,32 TS7023",
    "3,37 TS7022",
    "4,10 TS7023",
    "5,10 TS7023",
    "5,32 TS7022",
    "6,10 TS7023",
    "8,14 TS2322",
    "8,44 TS2322",
  ],
  "patterns.ts": [
    "3,10 TS7023",
    "3,32 TS7023",
    "4,10 TS7023",
    "4,32 TS7023",
    "4,37 TS7022",
    "5,10 TS7023",
    "5,71 TS7022",
    "6,10 TS7023",
    "6,33 TS7022",
    "7,10 TS7023",
    "8,10 TS7023",
    "8,51 TS7022",
    "9,10 TS7023",
    "10,10 TS7023",
    "12,14 TS2322",
    "12,44 TS2322",
  ],
};

test.concurrent.each(["lists.ts", "patterns.ts"] as const)("rings of functions through a default, %s", async name => {
  using dir = tempDir("check-defaults-in-rings", { "tsconfig.json": tsconfig, [name]: programs[name] });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty", "--all"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  const told = (stdout + stderr).matchAll(/^\w+\.ts\((\d+,\d+)\): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual(expected[name]);
});
