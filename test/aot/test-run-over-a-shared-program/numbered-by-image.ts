// What is numbered by image: regular expression literals, the objects of tagged templates, private names. Each answers for the image that RUNS, so a wrong one shows at once.
const tag = (strings: TemplateStringsArray, ...values: unknown[]) => strings.raw.join("_") + values.length;
class Marked {
  #theirs = 1;
  static has(o: object) {
    return #theirs in o;
  }
}
// Something is done behind each call, so that it is no tail call: a constant that is used once is put in its place, [x][0] is x, and `return f()` gives up the frame.
let behindCalls = 0;
export const countBehindCalls = () => behindCalls;
export function probeTheirs() {
  return [
    "t-h-e".replace(/-/g, "+"),
    "theirs 12".replace(/\d+/, "N"),
    /^th(.)irs$/.exec("theirs")?.[1],
    tag`their${1}template${2}`,
    Marked.has(new Marked()),
    "a,b;c".split(/[,;]/).length,
  ].join(" ");
}
export class Failure extends Error {}
export function fail(message: string): never {
  throw new Failure(message);
}
export function calls<T>(f: () => T): T {
  const r = f();
  behindCalls++;
  return r;
}
export function catches(f: () => unknown) {
  try {
    f();
    return "nothing thrown, " + probeTheirs();
  } catch (e) {
    return "they caught " + (e as Error).message + ", " + probeTheirs();
  }
}
export function hostFails() {
  const r = JSON.parse("{");
  behindCalls++;
  return r;
}
export function textFails() {
  const r = new Function("throw new RangeError('from their text')")();
  behindCalls++;
  return r;
}
export const textThatCatches = new Function("f", "try { f(); return 'nothing'; } catch (e) { return 'their text caught ' + e.message; }") as (f: () => unknown) => string;
export const holder = {
  get failing(): number {
    throw new Failure("their getter");
  },
};
export const trapped = new Proxy({}, { get() { throw new Failure("their trap"); } }) as Record<string, unknown>;
export async function* stepsThenFails() {
  yield 1;
  throw new Failure("their async generator");
}
export function* generatorFails() {
  yield 1;
  throw new Failure("their generator");
}
export async function laterFails() {
  await null;
  throw new Failure("their async function");
}
export function revive(text: string, reviver: (key: string, value: unknown) => unknown) {
  const r = JSON.parse(text, reviver);
  behindCalls++;
  return r;
}
export function sorts(list: number[], compare: (a: number, b: number) => number) {
  const r = list.sort(compare);
  behindCalls++;
  return r;
}
export const thenable = { then() { throw new Failure("their then"); } };
export const converts = { toString() { throw new Failure("their toString"); }, [Symbol.toPrimitive]: undefined };
export function spins(f: () => unknown): never {
  for (;;) f();
}
export function spinsAlone(): never {
  let n = 0;
  for (;;) n++;
}
export function spinsUnderTry(f: () => unknown) {
  try {
    for (;;) f();
  } finally {
    probeTheirs();
  }
}
