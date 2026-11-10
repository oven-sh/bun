// `function hide(row) { Object.defineProperty(row, "mark", { get() { .. } }) }`: a method that nobody calls hands it `this`, so a Row is expected at the parameter; the one call that runs hands it a number and throws.
// No Row ever comes to the definition, and Link says so: the layout changes in no way. The slot of `mark` was planned in the form of the descriptor all the same, an accessor, and the plain store `row.mark = i`
// stopped the executable: "RedefineProperty .. the compiler has proven that it never happens". Each program says what plain Bun says; the last four are the controls, where a Row does come to the definition.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const hide = `function hide(row) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; Object.defineProperty(row, "mark", { get() { return 7; }, configurable: true }); }`;
const rest = `class Row { size; constructor(n) { this.size = n + 1; } seal() { hide(this); } }
function fill(count) { const rows = []; for (let i = 0; i < count; i++) { const row = new Row(i); row.mark = i; rows.push(row); } return rows; }
function main() { const rows = fill(30); console.log(String(rows.length), rows[3].mark, Object.keys(rows[4]).join()); }
main();`;
const typed = (first: string) => `${first}
function hide(row: Row) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; Object.defineProperty(row, "mark", { get() { return 7; }, configurable: true }); }
class Row { size: number; constructor(n: number) { this.size = n + 1; } seal() { hide(this); } }
function fill(count: number) { const rows: Row[] = []; for (let i = 0; i < count; i++) { const row = new Row(i); (row as any).mark = i; rows.push(row); } return rows; }
function main() { const rows = fill(30); console.log(String(rows.length), (rows[3] as any).mark, Object.keys(rows[4]).join()); }
main();`;

// Five classes in one list are too many to tell apart: each list is a family of lost layouts.
const lost = (first: string) =>
  typed(`class Ant { a = 1; } class Bee { b = 2; } class Cat { c = 3; } class Dog { d = 4; }
function pick(i: number): object { const zoo = [new Row(90), new Ant(), new Bee(), new Cat(), new Dog()]; return zoo[i % 5]!; }
class Elk { e = 1; } class Fox { f = 2; } class Gnu { g = 3; } class Hen { h = 4; } class Ibis { i = 5; }
function other(i: number): object { const pen = [new Elk(), new Fox(), new Gnu(), new Hen(), new Ibis()]; return pen[i % 5]!; }
setTimeout(() => { ${first} console.log(typeof pick(1), typeof other(1)); });`);

const programs: Record<string, string> = {
  "a-number.js": `try { hide(0); } catch {}\n${hide}\n${rest}`,
  "a-number-at-the-end.js": `${hide}\n${rest}\ntry { hide(0); } catch {}`,
  "a-text.js": `try { hide("text"); } catch {}\n${hide}\n${rest}`,
  "a-number-where-a-row-is-written.ts": typed(`try { hide(0 as any); } catch {}`),
  "a-stranger-where-a-row-is-written.ts": typed(`hide(JSON.parse("{}"));`),
  "a-stranger-out-of-a-list-where-a-row-is-written.ts": typed(`for (const one of JSON.parse("[{}, {}]")) hide(one);`),
  "another-family-arrives-and-the-rows-are-lost.ts": lost(`for (let i = 0; i < 5; i++) hide(other(i) as any);`),
  "a-stranger-arrives-and-the-rows-are-lost.ts": lost(`hide(JSON.parse("{}"));`),
  "the-family-of-the-rows-arrives.ts": lost(
    `for (let i = 0; i < 5; i++) { const one: any = pick(i); hide(one); console.log(one.mark); }`,
  ),
  "a-row-in-sight.js": `setTimeout(() => { const one = new Row(1); hide(one); console.log(one.mark, Object.keys(one).join()); });\n${hide}\n${rest}`,
  "a-row-let-go.js": `try { hide(0); } catch {}\nsetTimeout(() => { globalThis.kept = new Row(2); hide(globalThis.kept); console.log(globalThis.kept.mark); });\n${hide}\n${rest}`,
  "a-row-let-go-where-a-row-is-written.ts": typed(
    `setTimeout(() => { (globalThis as any).kept = [new Row(2)]; for (const one of (globalThis as any).kept) { hide(one); console.log(one.mark, Object.keys(one).join()); } });`,
  ),
};

for (const [name, text] of Object.entries(programs)) {
  test(`the form of a descriptor is planned only on a layout that the definition may come to: ${name}`, async () => {
    using dir = tempDir("aot-the-form-of-a-descriptor", { [name]: text });
    const cwd = String(dir);
    const plain = await run([bunExe(), name], cwd, bunEnv);
    expect(plain.exitCode).toBe(0);
    const executable = join(cwd, "program");
    expect(
      (await run([bunExe(), "build", "--compile", "--aot", name, "--outfile", executable], cwd, bunEnv)).exitCode,
    ).toBe(0);
    const compiled = await run([executable], cwd, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);
}
