// Every rule of --aot runs 100,000 times and the results are counted: a line gives the same result the first time and the last.
declare const console: { log(...values: unknown[]): void };
import { rows } from "./sloppy.cjs";
class Box { label = "b"; size = 1; get(): string { return this.label; } }
function count(f: (i: number) => unknown): string { const seen: Record<string, number> = {}; for (let i = 0; i < 100000; i++) { let said: string; try { said = String(f(i)); } catch (e) { said = (e as Error).name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
const mixed: any[] = [1, "two", 3, null, 5, {}, 7, [8]];
function takes(n: number): number { return n; }
const untyped: any = takes;
async function later(n: number): Promise<number> { return n; }
const untypedLater: any = later;
function held(v: any): number { const n: number = v; return n; }
function back(v: any): number { return v; }
function field(v: any): number { const o: { n: number } = { n: 0 }; o.n = v; return o.n; }
function at(list: number[], i: number): number { return list[i]; }
const odd: number[] = [1, 2, 3]; Object.defineProperty(odd, 1, { get() { return 9; }, configurable: true });
const plain: number[] = [1, 2, 3];
for (const line of rows({ box: () => new Box(), lit: (): { a: number; b: string } => ({ a: 1, b: "x" }), Box })) console.log(line);
const typed: [string, (i: number) => unknown][] = [
  ["a parameter, typed caller", i => takes(mixed[i & 7])],
  ["a parameter, untyped caller", i => untyped(mixed[i & 7])],
  ["a variable", i => held(mixed[i & 7])],
  ["a return", i => back(mixed[i & 7])],
  ["a field", i => field(mixed[i & 7])],
  ["an element that is a getter", i => at(i & 1 ? odd : plain, 1)],
  ["strict: delete of a method of a built-in prototype", () => delete (Array.prototype as any).push],
  ["strict: store to a built-in prototype", () => { (Array.prototype as any).push = 1; return "stored"; }],
  ["strict: delete of a required field through any", () => delete (new Box() as any).label],
  ["strict: a compound assignment", i => { const o: { n: number } = { n: 1 }; try { o.n += mixed[i & 7]; } catch {} return typeof o.n; }],
];
for (const [name, f] of typed) console.log(name + ": " + count(f));
let rejected = 0, thrown = 0, fine = 0;
for (let i = 0; i < 20000; i++) { try { await untypedLater(mixed[i & 7]).then(() => fine++, () => rejected++); } catch { thrown++; } }
console.log("an async parameter:", fine, rejected, thrown);
