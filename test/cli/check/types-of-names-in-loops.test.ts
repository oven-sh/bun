// A loop's back edge may lead to a declaration whose type is being found, and then the name gets its type from the types the loop has collected so far.
// The check of the declaration compares its initializer with what its own search found: TypeScript accepts these declarations.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `interface A { k: 1; next(): B; make: new () => B; later(): Promise<B> }
interface B { k: 2; next(): A; make: new () => A; later(): Promise<A> }
declare const n: number; declare const first: A; declare const over: any;
declare function which(x: 1): A; declare function which(x: 2): B; declare function which(x: unknown): A | B;
export function called() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = a.next(); a = over(t); } }
export function optional() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = a?.next(); a = over(t as any); } }
export function twice() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = a.next().next(); a = over(t); } }
export function constructed() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = new a.make(); a = over(t); } }
export function overloaded() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = a.next(); a = which(t.k); } }
export async function awaited() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = await a.later(); a = over(t); } }
export function nested() { let a: A | B = first; for (let i = 0; i < n; i++) { let b = a.next(); while (i) { const t = b.next(); b = over(t); } a = over(b); } }
export function property() { let a: A | B = first; for (let i = 0; i < n; i++) { const { k = a.next() } = {} as { k?: B }; a = over(k); } }
export function element() { let a: A | B = first; for (let i = 0; i < n; i++) { const [k = a.next()] = [] as B[]; a = over(k); } }
export function read() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = a.next(); const p: never = t; a = over(t); } }
export function assigned() { let a: A | B = first; for (let i = 0; i < n; i++) { let t = a.next(); a = over(t); t = a.next(); } }
export function again() { let a: A | B = first; for (let i = 0; i < n; i++) { const t = a.next(); const u = a.next(); a = i ? over(t) : over(u); } }
export function before() { let a: A | B = first; for (let i = 0; i < n; i++) { const p: never = a; const t = a.next(); a = over(t); } }
`;

// The errors are those of TypeScript 7.0.2. It finds the type of a name that something else asks for first by what the loop has collected until then,
// and tells it there.
test("declarations in loops whose names the loop's own values are made from", async () => {
  using dir = tempDir("check-types-of-names-in-loops", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual([
    "(14,104) TS2322",
    "(15,113) TS2322",
    "(16,105) TS2322",
    "(17,86) TS2322",
    "(17,106) TS2322",
  ]);
});
