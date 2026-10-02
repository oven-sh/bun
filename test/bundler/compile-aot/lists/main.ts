const any = (v: unknown): any => v;
const show = (v: unknown): string =>
  typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : typeof v === "function" ? "fn" : typeof v === "symbol" ? "sym" :
  Array.isArray(v) ? "[" + v.map(show).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).join(",") + "}" : String(v);
const say = (name: string, f: () => unknown) => {
  let r: string;
  try { r = show(f()); } catch (e) { r = "throws " + any(e).constructor.name + ": " + any(e).message; }
  console.log(name + " -> " + r);
};
function count(this: unknown, ...a: unknown[]) { return show(this) + "|" + a.length + "|" + a.map(show).join(","); }
function fixed(this: unknown, a?: unknown, b?: unknown, c?: unknown) { return [show(this), show(a), show(b), show(c), arguments.length].join("|"); }
function elementCount(this: unknown) { return arguments.length; }
class Made { all: string; constructor(...a: unknown[]) { this.all = a.length + ":" + a.map(show).join(","); } }
class Derived extends Made { constructor(...a: unknown[]) { super(...a); } }
class DerivedMore extends Made { constructor(x: unknown, ...a: unknown[]) { super("first", ...a, x); } }
const holder = { name: "holder", m: count };

class Sub extends Array<unknown> {}
const sparse: unknown[] = [1, 2]; sparse[100000] = 3; sparse.length = 3;
const withProps: unknown[] = any(Object.assign([1, 2], { extra: 1 }));
const grown: unknown[] = []; for (let i = 0; i < 20; i++) grown.push(i); grown.length = 4;
const ownIterator: unknown[] = [1, 2]; any(ownIterator)[Symbol.iterator] = function* () { yield "own"; };
const otherProto: unknown[] = [1, 2]; Object.setPrototypeOf(otherProto, { [Symbol.iterator]: function* () { yield "proto"; }, length: 9 });
const lists: [string, unknown][] = [
  ["ints", [1, 2, 3]], ["doubles", [1.5, -0, 2.25]], ["nan", [1.5, NaN, Infinity]], ["values", ["a", null, undefined, { k: 1 }, [2]]],
  ["empty", []], ["holes", [1, , 3]], ["double holes", [1.5, , 3.5]], ["all holes", new Array(3)], ["one", [7]], ["grown", grown],
  ["made ints", Array.from({ length: 3 }, (_, i) => i)], ["made doubles", Array.from({ length: 3 }, (_, i) => i + 0.5)],
  ["frozen", Object.freeze([1, 2])], ["sparse", sparse], ["with properties", withProps], ["subclass", Sub.from([1, 2])],
  ["own iterator", ownIterator], ["other prototype", otherProto], ["typed array", new Uint8Array([1, 2])], ["array-like", { length: 2, 0: "a", 1: "b" }],
  ["string", "hi"], ["set", new Set([1, 2])], ["map", new Map([[1, 2]])], ["generator", (function* () { yield 1; yield 2; })()],
  ["proxy", new Proxy([1, 2], {})], ["null", null], ["undefined", undefined], ["number", 5], ["object", {}], ["function", () => 1], ["symbol", Symbol.iterator],
  ["arguments", (function (..._: unknown[]) { return arguments; })(1, 2)],
];
for (const [name, list] of lists) {
  const l = any(list);
  say(`apply ${name}`, () => { const r = count.apply("t", l); return r; });
  say(`apply fixed ${name}`, () => { const r = fixed.apply(1, l); return r; });
  say(`apply tail ${name}`, () => count.apply("t", l));
  if (name === "generator") continue;
  say(`spread ${name}`, () => { const r = count(...l); return r; });
  say(`spread tail ${name}`, () => count(...l));
  say(`spread after ${name}`, () => { const r = count(1, "x", ...l); return r; });
  say(`spread before ${name}`, () => { const r = count(...l, 2); return r; });
  say(`spread twice ${name}`, () => { const r = count(...l, ...l); return r; });
  say(`spread method ${name}`, () => { const r = holder.m(...l); return r; });
  say(`spread fixed ${name}`, () => { const r = fixed(...l); return r; });
  say(`spread new ${name}`, () => new Made(...l).all);
  say(`spread super ${name}`, () => new Derived(...l).all);
  say(`spread super more ${name}`, () => new DerivedMore(0, ...l).all);
  say(`spread ignored ${name}`, () => { count(...l); return "ok"; });
  say(`call spread ${name}`, () => { const r = count.call(...(l as [unknown])); return r; });
  say(`Reflect.apply ${name}`, () => Reflect.apply(count, "r", l));
}

let order: string[] = [];
const noting = (s: string, v: unknown) => { order.push(s); return v; };
const shrinking = [1, 2, 3];
say("spread, then what changes it", () => { const r = count(...shrinking, shrinking.pop()); return r; });
say("in order", () => { order = []; const r = count(noting("a", 1), ...any(noting("b", [2])), noting("c", 3), ...any(noting("d", [4]))); return r + " " + order.join(""); });
const getter = { get k() { shrinking.push(9); return "k"; } };
say("spread, then a getter", () => { const r = count(...shrinking, getter.k); return r; });

function pass(this: unknown) { const r = count.apply(this, any(arguments)); return r; }
function passTail(this: unknown) { return count.apply(this, any(arguments)); }
function passNamed(this: unknown, a?: unknown, b?: unknown, c?: unknown) { const r = count.apply(this, any(arguments)); return r + "/" + show(a) + show(b) + show(c); }
function passNamedTail(this: unknown, _a?: unknown, _b?: unknown, _c?: unknown) { return count.apply(this, any(arguments)); }
function passFixed(this: unknown) { const r = fixed.apply(this, any(arguments)); return r; }
function passNew() { return new (any(Made.bind).apply(Made, [null, ...arguments]))().all; }
for (const f of [pass, passTail, passNamed, passNamedTail, passFixed]) {
  say(`${f.name} 0`, () => any(f).call("t")); say(`${f.name} 1`, () => any(f).call("t", 1)); say(`${f.name} 3`, () => any(f).call("t", 1, "b", null));
  say(`${f.name} 6`, () => any(f).call("t", 1, 2.5, "c", undefined, {}, [6])); say(`${f.name} spread`, () => any(f)(...[1, 2, 3, 4]));
}
say("passNew", () => any(passNew)(1, 2));
function reassigns(a: unknown, b?: unknown) { a = "new a"; b = "new b"; const r = count.apply(null, any(arguments)); return r + "/" + show(a) + show(b); }
say("parameters assigned to", () => reassigns(1, 2)); say("parameters assigned to, one passed", () => reassigns(1));
const thrower = (...a: unknown[]) => { throw new RangeError("thrown with " + a.length); };
function reassignsInTry(a: unknown, b?: unknown) { try { a = "in try"; thrower(); b = "not reached"; } catch { b = "in catch"; } const r = count.apply(null, any(arguments)); return r + "/" + show(a) + show(b); }
say("parameters assigned to in a try", () => reassignsInTry(1, 2));
function mutates(_a?: unknown, _b?: unknown) { arguments[0] = "changed"; const r = count.apply(null, any(arguments)); return r; }
say("arguments changed first", () => mutates(1, 2));
function shortens(_a?: unknown, _b?: unknown) { arguments.length = 1; const r = count.apply(null, any(arguments)); return r; }
say("arguments shortened first", () => shortens(1, 2));
let kept: any;
function escapes(_a?: unknown, _b?: unknown) { const r1 = count.apply(null, any(arguments)); kept = arguments; kept[1] = "later"; const r2 = count.apply(null, any(arguments)); return r1 + " " + r2; }
say("arguments got hold of in between", () => escapes(1, 2));
function readsToo(_a?: unknown) { const n = arguments.length; const first = arguments[0]; const r = count.apply(null, any(arguments)); return n + show(first) + r; }
say("arguments read too", () => readsToo(1, 2 as never));
const seen: unknown[] = [];
const notAFunction = { apply(t: unknown, a: any) { seen.push(a); a[0] = "seen " + seen.length; return "mine " + show(t) + a.length + Array.isArray(a) + show(a[0]); } };
function toItsOwnApply(_a?: unknown) { const r1 = notAFunction.apply(1, arguments); const r2 = notAFunction.apply(2, arguments); const r3 = count.apply(3, any(arguments)); return [r1, r2, r3, seen[0] === seen[1]].join(" "); }
say("an apply of its own", () => toItsOwnApply("x"));
function withApply(this: unknown) { return "never"; } any(withApply).apply = function (t: unknown, a: any) { return "overridden " + show(t) + a.length; };
function toOverridden(_a?: unknown) { const r = withApply.apply(1, any(arguments)); return r; }
say("a function whose apply is another", () => toOverridden(1));
function inLoop(_a?: unknown) { let s = ""; for (let i = 0; i < 3; i++) s += count.apply(i, any(arguments)) + ";"; return s; }
say("in a loop", () => inLoop("l", 2 as never));
function fromArrow(_a?: unknown) { return (() => { const r = count.apply(null, any(arguments)); return r; })(); }
say("from an arrow function", () => fromArrow(1, 2 as never));
function* fromGenerator(_a?: unknown) { yield count.apply(null, any(arguments)); yield count.apply(null, any(arguments)); }
say("from a generator", () => [...any(fromGenerator)(1, 2)].join(" "));
async function fromAsync(_a?: unknown) { const r1 = count.apply(null, any(arguments)); await null; const r2 = count.apply(null, any(arguments)); return r1 + " " + r2; }
function conditionally(c: boolean, _b?: unknown) { const list = c ? arguments : [0]; const r = count.apply(null, any(list)); return r; }
say("one of two lists", () => conditionally(true, 2) + " " + conditionally(false, 2));
function inTry(_a?: unknown) { try { const r = thrower.apply(null, any(arguments)); return r; } catch (e) { return "caught " + any(e).message + " " + count.apply(null, any(arguments)); } }
say("thrown through", () => inTry(1, 2 as never));
function spreadsArguments(_a?: unknown) { const r = count(...arguments); return r; }
say("arguments spread", () => spreadsArguments(1, 2 as never));

function rest(...xs: unknown[]) { const r = count(...xs); return r; }
function restTail(...xs: unknown[]) { return count(...xs); }
function restAfter(a?: unknown, b?: unknown, ...xs: unknown[]) { const r = count(...xs); return r + "/" + show(a) + show(b); }
function restAfterTail(_a?: unknown, _b?: unknown, ...xs: unknown[]) { return count(...xs); }
function restWith(a?: unknown, ...xs: unknown[]) { const r = count(a, "mid", ...xs); return r; }
function restThen(a?: unknown, ...xs: unknown[]) { const r = count(...xs, a); return r; }
function restTwice(...xs: unknown[]) { const r = count(...xs, ...xs); return r; }
function restMethod(...xs: unknown[]) { const r = holder.m(...xs); return r; }
function restNew(...xs: unknown[]) { return new Made(...xs).all; }
function restApply(...xs: unknown[]) { const r = count.apply("a", xs); return r; }
function restFixed(...xs: unknown[]) { const r = fixed(...any(xs)); return r; }
for (const f of [rest, restTail, restAfter, restAfterTail, restWith, restThen, restTwice, restMethod, restNew, restApply, restFixed]) {
  say(`${f.name} 0`, () => f()); say(`${f.name} 1`, () => f(1)); say(`${f.name} 2`, () => f(1, "b")); say(`${f.name} 3`, () => f(1, "b", null));
  say(`${f.name} 6`, () => f(1, 2.5, "c", undefined, {}, [6])); say(`${f.name} spread`, () => f(...[1, 2, 3, 4])); say(`${f.name} apply`, () => f.apply(null, [1, 2, 3]));
}
function restUsedToo(...xs: unknown[]) { const n = xs.length; const r = count(...xs); return n + r + show(xs[0]); }
say("rest used too", () => restUsedToo(1, 2));
function restChanged(...xs: unknown[]) { xs.push("pushed"); xs[0] = "changed"; const r = count(...xs); return r; }
say("rest changed first", () => restChanged(1, 2));
function restInLoop(...xs: unknown[]) { let s = ""; for (let i = 0; i < 3; i++) s += count(i, ...xs) + ";"; return s; }
say("rest in a loop", () => restInLoop("l", 2));
function restInTry(...xs: unknown[]) { try { const r = thrower(...xs); return r; } catch (e) { return "caught " + any(e).message + " " + count(...xs); } }
say("rest thrown through", () => restInTry(1, 2));
function restReturned(...xs: unknown[]) { const r = count(...xs); return [r, xs]; }
say("rest returned", () => restReturned(1, 2));
const restArrow = (...xs: unknown[]) => { const r = count(...xs); return r; };
say("rest of an arrow function", () => restArrow(1, 2));
function restDeep(n: number, ...xs: unknown[]): number { return n ? 1 + restDeep(n - 1, ...xs) : xs.length; }
say("rest, deep", () => restDeep(3000, 1, 2, 3));
function restDeepTail(n: number, ...xs: unknown[]): number { return n ? restDeepTail(n - 1, ...xs) : xs.length; }
say("rest, deep, in tail position", () => restDeepTail(200000, 1, 2, 3));
function passDeepTail(this: unknown, n: number, _x?: unknown): unknown { if (!n) return arguments.length; arguments[0] = n - 1; return passDeepTail.apply(this, any(arguments)); }
say("arguments, deep, in tail position", () => passDeepTail(100000, "x"));
function forever(...xs: unknown[]): unknown { return 1 + any(forever(...xs)); }
say("without end", () => { try { return forever(1, 2); } catch (e) { return any(e).constructor.name; } });

say("Math.max spread ints", () => Math.max(...[3, 9, 2])); say("Math.max spread doubles", () => Math.max(...[3.5, 9.25, 2]));
say("Math.max apply", () => Math.max.apply(null, [3, 9, 2])); say("Math.min of none", () => Math.min(...[]));
say("fromCharCode apply", () => String.fromCharCode.apply(null, [104, 105]));
say("push spread", () => { const a = [1]; const n = a.push(...[2, 3]); return n + show(a); });
say("push apply", () => { const a = [1]; Array.prototype.push.apply(a, [2, 3]); return a; });
say("concat apply", () => Array.prototype.concat.apply([], [[1], [2, 3]] as never));
const bound = count.bind("bound", "b1");
say("bound spread", () => { const r = bound(...[1, 2]); return r; }); say("bound apply", () => { const r = bound.apply("ignored", [1, 2]); return r; });
const proxied = new Proxy(count, {});
say("proxy spread", () => { const r = proxied(...[1, 2]); return r; });
say("class called", () => { const r = any(Made)(...[1]); return r; }); say("class applied", () => { const r = any(Made).apply(null, [1]); return r; });
say("undefined called", () => { const r = any(undefined)(...[1]); return r; }); say("number applied", () => { const r = any(holder).name.apply(null, [1]); return r; });
say("missing method spread", () => { const r = any(holder).nothing(...[1]); return r; });
say("new of an arrow", () => new (any(restArrow))(...[1])); say("new of bound", () => new (any(Made.bind(null, "b")))(...[1, 2]).all);
say("new of a function", () => { function F(this: any, ...a: unknown[]) { this.n = a.length; } return new (any(F))(...[1, 2, 3]).n; });
say("Reflect.construct", () => Reflect.construct(Made, [1, 2]).all);

for (const n of [100, 5000, 70000, 1000000, 1100000, 5000000]) {
  const ints: number[] = [], doubles: number[] = [];
  for (let i = 0; i < n; i++) { ints.push(i); doubles.push(i + 0.5); }
  const name = (f: () => unknown) => { try { return f(); } catch (e) { return any(e).constructor.name; } };
  say(`apply ${n}`, () => name(() => { const r = elementCount.apply(null, any(ints)); return r; })); say(`spread ${n}`, () => name(() => { const r = any(elementCount)(...doubles); return r; }));
  say(`max ${n}`, () => name(() => Math.max(...ints)));
}

const arrayIterator = Array.prototype[Symbol.iterator];
const thisOfIterator: unknown[] = [];
say("a new way to iterate over arrays", () => { any(Array.prototype)[Symbol.iterator] = function* (this: unknown[]) { thisOfIterator.push(this); yield "patched"; yield this.length; }; return "done"; });
say("patched: spread", () => { const r = count(...[1, 2, 3]); return r; }); say("patched: spread after", () => { const r = count(0, ...[1, 2, 3]); return r; });
say("patched: apply", () => { const r = count.apply(null, [1, 2, 3]); return r; });
say("patched: rest", () => rest(1, 2)); say("patched: rest tail", () => restTail(1, 2)); say("patched: rest with", () => restWith(1, 2, 3)); say("patched: arguments", () => any(pass)(1, 2));
say("patched: rest twice is one array", () => { thisOfIterator.length = 0; const r = restTwice(1, 2); return r + " " + (thisOfIterator.length === 2 && thisOfIterator[0] === thisOfIterator[1]); });
say("patched: super", () => new Derived(1, 2).all);
say("the old way again", () => { any(Array.prototype)[Symbol.iterator] = arrayIterator; return "done"; });
say("restored: spread", () => { const r = count(...[1, 2, 3]); return r; }); say("restored: rest", () => rest(1, 2));
const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]()); const next = iteratorPrototype.next;
say("a new next", () => { let n = 0; iteratorPrototype.next = function () { return n++ < 2 ? { done: false, value: "next " + n } : ((n = 0), { done: true, value: undefined }); }; return "done"; });
say("new next: spread", () => { const r = count(...[1, 2, 3]); return r; }); say("new next: rest", () => rest(1)); say("new next: apply", () => { const r = count.apply(null, [1, 2, 3]); return r; });
say("the old next again", () => { iteratorPrototype.next = next; return "done"; });
say("an element on the prototype", () => { any(Array.prototype)[1] = "from the prototype"; return "done"; });
say("holes: apply", () => { const r = count.apply(null, [1, , 3]); return r; }); say("holes: spread", () => { const r = count(...[1, , 3]); return r; });
say("no element on the prototype", () => delete any(Array.prototype)[1]);

const where = (f: () => unknown) => { try { f(); return "no error"; } catch (e) { return String(any(e).stack).split("\n").slice(0, 3).map(l => l.replace(/\(?[^ (]*[\\/]/, "").replace(/\)$/, "")).join(" < "); } };
say("where: not iterable", () => where(() => { const r = count(1, ...any(5)); return r; }));
say("where: thrown by the callee", () => where(() => { const r = thrower(...[1, 2]); return r; }));
say("where: thrown by the callee of apply", () => where(function (this: unknown) { const r = thrower.apply(null, any(arguments)); return r; }));
say("where: not a function", () => where(() => { const r = any(holder).nothing(...[1]); return r; }));

let total = 0;
for (let i = 0; i < 20000; i++) {
  const o = { i }, s = "s" + i;
  total += any(pass)(o, s, i).length + rest(o, s, i + 0.5).length + restWith(o, s).length + restTail(s).length + any(passTail)(o).length + count(...[o, s], ...[i]).length + new Derived(o, s).all.length;
}
say("many times", () => total);
console.log(await fromAsync(1, 2 as never));
{
  const a = [1, 2], b = [3, 4], none: number[] = [];
  say("two arrays", () => [...a, ...b]);
  say("three", () => [...a, ...b, ...a]);
  say("with itself", () => [...a, ...a]);
  say("something first", () => [0, ...a, ...b]);
  say("something last", () => { const x = 9; return [...a, ...b, x]; });
  say("something between", () => { const x = 9; return [...a, x, ...b]; });
  say("with nothing", () => [...none, ...a, ...none]);
  say("nothing at all", () => [...none, ...none]);
  say("it is a new one", () => { const r = [...a, ...b]; r.push(5); return [r, a, b]; });
  say("holes", () => { const h = [1, , 3] as number[]; const r = [...h, ...h]; return [r, 1 in r, r.length]; });
  say("doubles and others", () => [...[1.5, 2.5], ...["s"], ...[{}], ...[1]]);
  say("a call between", () => { const c = [1, 2]; const grow = () => { c.push(3); return [9]; }; return [...c, ...grow()]; });
  say("a call first", () => { const c = [1, 2]; const grow = () => { c.push(3); return [9]; }; return [...grow(), ...c]; });
  say("a generator that changes the other", () => { const c = [1, 2]; function* g() { c.push(7); yield 8; c.push(9); } const it = g(); return [[...c, ...it], c]; });
  say("a generator first", () => { const c = [1, 2]; function* g() { c.push(7); yield 8; } const it = g(); return [[...it, ...c], c]; });
  say("a string and a set", () => { const s = "ab", t = new Set([1, 2]); return [...s, ...t, ...a]; });
  say("a map", () => { const m = new Map([[1, "x"]]); return [...m, ...a]; });
  say("not iterable", () => { const n = any(5); return [...a, ...n]; });
  say("nothing to iterate", () => { const n = any(undefined); return [...a, ...n]; });
  say("throws half way", () => { const log: number[] = []; function* g() { log.push(1); yield 1; throw new RangeError("half way"); } const it = g(); try { return [...a, ...it]; } catch (e) { return [any(e).message, log]; } });
  class Sub extends Array<number> {}
  say("a subclass", () => { const s = Sub.from([1, 2]); const r = [...s, ...a]; return [r, r instanceof Sub]; });
  class Odd extends Array<number> { *[Symbol.iterator]() { yield 42; } }
  say("a subclass that iterates its own way", () => { const o = Odd.from([1, 2]); return [...a, ...o]; });
  say("an array that iterates its own way", () => { const o: any = [1, 2]; o[Symbol.iterator] = function* () { yield "mine"; }; return [...a, ...o]; });
  say("arguments", function () { return [...(arguments as any), ...a]; });
  say("typed arrays", () => { const t = new Uint8Array([7, 8]); return [...t, ...a]; });
  say("long", () => { const l = Array.from({ length: 1000 }, (_, i) => i); const r = [...l, ...l]; return [r.length, r[999], r[1000], r[1999]]; });
  say("many parts", () => [...a, ...a, ...a, ...a, ...a, ...a, ...a, ...a, ...a, ...a, ...a, ...a].length);
  say("frozen", () => { const f = Object.freeze([1, 2]); return [...f, ...f]; });
  say("in a loop", () => { let r: number[] = []; for (let i = 0; i < 20; i++) { const one = [i]; r = [...r, ...one]; } return r.length + ":" + r[19]; });
  try {
    const original = Array.prototype[Symbol.iterator];
    any(Array.prototype)[Symbol.iterator] = function* (this: unknown[]) { yield "patched"; };
    say("iteration is not what it was", () => [...a, ...b]);
    any(Array.prototype)[Symbol.iterator] = original;
  } catch (e) { console.log("iteration cannot be changed: " + any(e).constructor.name); }
  say("and is again", () => [...a, ...b]);
}
{
  const isWord = (s: string) => /^\w+$/.test(s);
  say("test", () => [isWord("abc"), isWord("a b"), isWord("")]);
  const first = (s: string) => /(\d)(?<rest>\d*)/.exec(s);
  say("exec", () => { const m = first("a123")!; return [m[0], m[1], m.groups!.rest, m.index, first("x")]; });
  say("many times", () => { let n = 0; for (let i = 0; i < 300; i++) n += /7/.test(String(i)) ? 1 : 0; return n; });
  say("results are their own", () => { const x = first("12")!, y = first("34")!; x[0] = "changed"; return [x[0], y[0]]; });
  say("what matched last", () => { /b(.)/.test("abc"); return [any(RegExp).$1, any(RegExp).lastMatch]; });
  const again = (s: string, depth: number): boolean => /^(a+)$/.test(s) && (depth ? again(s + "a", depth - 1) : true);
  say("while it is in use", () => again("a", 5));
  say("with a flag", () => [/A/i.test("a"), /^b$/m.test("a\nb"), /a.c/s.test("a\nc"), /\u{61}/u.test("a")]);
  say("global is another matter", () => { const f = (s: string) => /a/g.test(s); return [f("a"), f("a"), f("a")]; });
  say("sticky too", () => { const f = (s: string) => /a/y.test(s); return [f("a"), f("ba"), f("a")]; });
  say("converts what it is given", () => [/1/.test(any(1)), /undefined/.test(any(undefined)), /null/.exec(any(null))![0]]);
  say("what it is given throws", () => /x/.test(any({ toString() { throw new RangeError("no"); } })));
  say("after a collection", () => { const f = (s: string) => /z/.test(s); const r = [f("z")]; Bun.gc(true); r.push(f("z"), f("y")); return r; });
}
