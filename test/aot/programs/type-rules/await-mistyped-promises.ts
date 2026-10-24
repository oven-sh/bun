// The value that an await of a `PromiseLike<T>` or a `Promise<T>` yields is not checked against `T`: declaration files declare the one and extend the other. A value of another type goes on as in plain Bun, from a native promise or a thenable, inside try blocks and loops, until it enters something written: `return n + 1` under `Promise<number>` rejects where the sum is a string. type-rules/awaited-value-checked-against-annotation has the awaited values that flow into a declared type.
interface Point { x: number; y: number }
class Box { constructor(public held: string) {} }
type Handler = (text: string) => number;

function lie<T>(value: unknown): Promise<T> {
  return Promise.resolve(value) as Promise<T>;
}
function thenable<T>(value: unknown): PromiseLike<T> {
  return { then(resolve: (value: T) => void) { resolve(value as T); } } as PromiseLike<T>;
}
async function text(p: PromiseLike<string>): Promise<number> { const s = await p; return s.length; }
async function textOfPromise(p: Promise<string>): Promise<number> { const s = await p; return s.length; }
async function optionalText(p: PromiseLike<string | undefined>): Promise<string> { const s = await p; return s === undefined ? "none" : "some " + s; }
async function list(p: PromiseLike<string[]>): Promise<number> { const l = await p; return l.length; }
async function point(p: PromiseLike<Point>): Promise<number> { const q = await p; return q.x + q.y; }
async function box(p: PromiseLike<Box>): Promise<string> { const b = await p; return b.held; }
async function handler(p: PromiseLike<Handler>): Promise<number> { const h = await p; return h("four"); }
async function either(p: PromiseLike<Box | string>): Promise<string> { const e = await p; return typeof e === "string" ? e : e.held; }
async function count(p: PromiseLike<number>): Promise<number> { const n = await p; return n + 1; }
async function flag(p: PromiseLike<boolean>): Promise<string> { const f = await p; return f ? "yes" : "no"; }
async function caught(p: PromiseLike<string>): Promise<string> {
  try {
    const s = await p;
    return "fine " + s.length;
  } catch (error) {
    return "caught " + (error as Error).name + ": " + (error as Error).message;
  }
}
async function inALoop(all: PromiseLike<string>[]): Promise<number> {
  let sum = 0;
  for (const p of all) sum += (await p).length;
  return sum;
}
async function twice(p: PromiseLike<string>, q: PromiseLike<string[]>): Promise<number> {
  const s = await p;
  const l = await q;
  return s.length + l.length;
}
async function row(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    console.log(name, String(await run()));
  } catch (error) {
    console.log(name, "threw", (error as Error).name);
  }
}
async function main(): Promise<void> {
  await row("text", () => text(lie("four")));
  await row("text of a thenable", () => text(thenable("three")));
  await row("text, a number", () => text(lie(4)));
  await row("text, an object", () => text(lie({ length: 9 })));
  await row("text, an array", () => text(lie(["a"])));
  await row("text, a thenable's number", () => text(thenable(4)));
  await row("text of a promise", () => textOfPromise(lie("four")));
  await row("text of a promise, a number", () => textOfPromise(lie(4)));
  await row("optional text", () => optionalText(lie("s")));
  await row("optional text, undefined", () => optionalText(lie(undefined)));
  await row("optional text, false", () => optionalText(lie(false)));
  await row("optional text, 0", () => optionalText(lie(0)));
  await row("list", () => list(lie(["a", "b"])));
  await row("list, a string", () => list(lie("ab")));
  await row("list, an object", () => list(lie({ length: 2 })));
  await row("point", () => point(lie<Point>({ x: 1, y: 2 } as Point)));
  await row("point, a string", () => point(lie("xy")));
  await row("point, a box", () => point(lie(new Box("b"))));
  await row("box", () => box(lie(new Box("held"))));
  await row("box, a look-alike", () => box(lie({ held: "not a box" })));
  await row("box, a number", () => box(lie(1)));
  await row("handler", () => handler(lie((t: string) => t.length)));
  await row("handler, a string", () => handler(lie("h")));
  await row("either, a string", () => either(lie("e")));
  await row("either, a box", () => either(lie(new Box("in a box"))));
  await row("either, a number", () => either(lie(7)));
  await row("count", () => count(lie(41)));
  await row("count, a string", () => count(lie("41")));
  await row("flag", () => flag(lie(true)));
  await row("flag, a number", () => flag(lie(1)));
  await row("caught", () => caught(lie("abc")));
  await row("caught, a number", () => caught(lie(3)));
  await row("in a loop", () => inALoop([lie("a"), lie("bc"), thenable("def")]));
  await row("in a loop, the second is wrong", () => inALoop([lie("a"), lie(2), lie("def")]));
  await row("twice", () => twice(lie("ab"), lie(["c"])));
  await row("twice, the second is wrong", () => twice(lie("ab"), lie("c")));
}
main();
