// Defining a property with a value through a built-in function succeeds whatever the value is, as in plain JavaScript. Each case runs 100,000 times and the results are counted.
import { define, rows } from "./sloppy.cjs";
class Box { label = "b"; size = 1; late: number; constructor() { this.late = 2; } }
function count(f: (i: number) => unknown): string { const seen: Record<string, number> = {}; for (let i = 0; i < 100000; i++) { let said: string; try { said = String(f(i)); } catch (e) { said = (e as Error).name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
for (const line of rows(() => new Box())) console.log(line);
const wrong: any[] = ["big"];
const typed: [string, (i: number) => unknown][] = [
  ["TypeScript calls a small function of JavaScript that defines", i => define(new Box(), i % 1000 === 999 ? "big" : i)],
  ["TypeScript: Object.defineProperty", i => { Object.defineProperty(new Box(), "size", { value: i % 1000 === 999 ? wrong[0] : i }); return "defined"; }],
  ["TypeScript: the fields that a constructor defines", i => new Box().late + new Box().size],
];
for (const [name, f] of typed) console.log(name + ": " + count(f));
