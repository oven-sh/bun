import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A value that satisfies its type is never refused: each of these programs prints under `bun run --aot`, and as compiled code under `--debug-aot`, what plain Bun prints.
const head = `declare const console: { log(...values: unknown[]): void };
type Item = { flag?: boolean };
const attempt = (f: () => unknown): void => { try { console.log(JSON.stringify(f()) ?? "undefined"); } catch (e) { console.log(String(e).split(" (bun")[0]); } };
`;
const fits: Record<string, string> = {
  "undefined comes by the other arm of || into an optional field": `
    class Holder { flag?: boolean; constructor(list: Item[]) { this.flag = list.some(item => item.flag === true) || undefined; } }
    attempt(() => new Holder([])); attempt(() => new Holder([{ flag: false }])); attempt(() => new Holder([{ flag: true }]));`,
  "where the class is made by the code of the module": `
    class Holder { flag?: boolean; constructor(list: Item[]) { this.flag = list.some(item => item.flag === true) || undefined; } }
    console.log(JSON.stringify(new Holder([])), JSON.stringify(new Holder([{ flag: true }])));`,
  "and into a variable whose type is inferred": `
    function any(list: Item[]) { const found = list.some(item => item.flag === true) || undefined; return found; }
    attempt(() => any([])); attempt(() => any([{ flag: true }]));`,
  "null comes by the other arm of ??": `
    function size(sizes: Map<string, number>, name: string) { const found = sizes.get(name) ?? null; return found; }
    attempt(() => size(new Map(), "a")); attempt(() => size(new Map([["a", 1]]), "a"));`,
  "a string comes by the other arm of &&": `
    function name(list: Item[]) { const found = list.some(item => item.flag === true) && "found"; return found; }
    attempt(() => name([])); attempt(() => name([{ flag: true }]));`,
  "in a try block, where every call ends a block": `
    function any(list: Item[]) { try { const found = list.some(item => item.flag === true) || undefined; return found; } finally { list.length = 0; } }
    attempt(() => any([])); attempt(() => any([{ flag: true }]));`,
  "an optional chain in a try block, whose short way yields undefined": `
    class Inner { id: number; constructor(id: number) { this.id = id; } }
    interface Outer { inner: Inner | null }
    const outside: Inner = JSON.parse('{"id":5}');
    function read(p: Outer) { try { return p.inner?.id; } finally { p.inner = null; } }
    attempt(() => read({ inner: null })); attempt(() => read({ inner: new Inner(1) })); attempt(() => read({ inner: outside }));`,
  "a member that a spread leaves out is read as undefined where the executable reads it so": `
    interface Pair { a: number; b: number }
    attempt(() => { const heir: Pair = Object.assign(Object.create({ b: 2 }), { a: 1 }); const copy: Pair = { ...heir }; return copy.a + " " + copy.b; });`,
  "and what does not satisfy its type is not refused either: a string out of a function that is declared to answer a boolean": `
    function first(ask: () => boolean) { const found = ask() || undefined; return found; }
    const lies: any = () => "text";
    attempt(() => first(() => false)); attempt(() => first(() => true)); attempt(() => first(lies));`,
};

async function ran(text: string, ...flags: string[]) {
  using dir = tempDir("run-aot-accepts-matching-arguments", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true } }`,
    "main.ts": head + text,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", ...flags, "main.ts"], String(dir));
  return { stdout, stderr: stderr.split("\n").filter(line => /error/i.test(line)), exitCode };
}

test.concurrent.each(Object.entries(fits))("%s", async (_, text) => {
  expect(await ran(text, "--aot")).toEqual(await ran(text));
  expect(await ran(text, "--debug-aot")).toEqual(await ran(text));
});
