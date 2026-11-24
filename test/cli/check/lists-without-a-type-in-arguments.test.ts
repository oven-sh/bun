// While a loop is analyzed, TypeScript keeps what it reports about an argument, also for an argument that is a list, an object or a text made of the
// list that has no type yet.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `declare const n: number;
export function wrapped() { let a = []; for (let i = 0; i < n; i++) { a = a.concat([a]); } }
export function sliced() { let a = []; for (let i = 0; i < n; i++) { a = a.concat([a]).slice(0, 3); a = a.slice(1); } }
export function twice() { let a = []; for (let i = 0; i < n; i++) { a = a.concat([a, [a]]).slice(0, 3); } }
export function plain() { let a = []; for (let i = 0; i < n; i++) { a = a.concat(a).slice(0, 3); } }
export function object() { let a = []; for (let i = 0; i < n; i++) { a = a.concat({ v: a }); } }
export function spread() { let a = []; for (let i = 0; i < n; i++) { a = a.concat([...a]); } }
export function called() { let a = []; for (let i = 0; i < n; i++) { a = a.concat(String(a)); } }
export function mapped() { let a = []; for (let i = 0; i < n; i++) { a = a.map(x => [x, a]); } }
export function joined() { let a = []; for (let i = 0; i < n; i++) { a = a.concat(\`\${a}\`); } }
export function other() { let a = []; let b = []; for (let i = 0; i < n; i++) { a = a.concat([b]); b = b.concat([a]); } }
export function chosen() { let a = []; for (let i = 0; i < n; i++) { a = a.concat(i ? [a] : a); } }
export function nested() { let a = []; for (let i = 0; i < n; i++) { while (i) { a = a.concat([a]); } a = a.concat([a]); } }
`;

// The errors are those of TypeScript 7.0.2.
test("lists without a type in the arguments of calls in loops", async () => {
  using dir = tempDir("check-lists-without-a-type-in-arguments", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual([
    "(2,33) TS7034",
    "(2,75) TS7005",
    "(2,85) TS7005",
    "(3,32) TS7034",
    "(3,74) TS7005",
    "(3,84) TS7005",
    "(4,31) TS7034",
    "(4,73) TS7005",
    "(4,83) TS7005",
    "(4,87) TS7005",
    "(5,31) TS7034",
    "(5,73) TS7005",
    "(5,82) TS7005",
    "(6,32) TS7034",
    "(6,74) TS7005",
    "(6,88) TS7005",
    "(7,32) TS7034",
    "(7,74) TS7005",
    "(7,87) TS7005",
    "(8,32) TS7034",
    "(8,74) TS7005",
    "(8,90) TS7005",
    "(9,32) TS7034",
    "(9,74) TS7005",
    "(9,89) TS7005",
    "(10,32) TS7034",
    "(10,74) TS7005",
    "(10,86) TS7005",
    "(11,31) TS7034",
    "(11,43) TS7034",
    "(11,85) TS7005",
    "(11,95) TS7005",
    "(11,104) TS7005",
    "(12,32) TS7034",
    "(12,74) TS7005",
    "(12,88) TS7005",
    "(12,93) TS7005",
    "(13,32) TS7034",
    "(13,86) TS7005",
    "(13,96) TS7005",
  ]);
});
