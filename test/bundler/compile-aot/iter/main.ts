// What a for-of does with an iterator that there is no shortcut for: every step of it, and every way each step can go wrong.
const out: string[] = [];
const any = (x: unknown): any => x;
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
const log: string[] = [];
const took = () => { const t = log.join(","); log.length = 0; return t; };
const collect = (it: any, limit = 20) => { const r: unknown[] = []; for (const x of it) { r.push(x); if (r.length >= limit) break; } return r.join("|"); };
// An iterable that logs every operation on it. results: the successive return values of next().
const scripted = (results: unknown[], more: Record<string, unknown> = {}) => ({
  [Symbol.iterator]() { log.push("open"); let i = 0; return { next() { log.push("next"); return results[i++]; }, ...more }; },
});

// ---- generators
function* upTo(n: number) { for (let i = 0; i < n; i++) yield i; }
function* withFinally() { try { yield 1; yield 2; yield 3; } finally { log.push("finally"); } }
function* throwsAtSecond() { yield "a"; throw new RangeError("second"); }
function* delegating() { yield* upTo(2); yield* [7, 8]; yield* "xy"; }
say("a generator", () => collect(upTo(5)));
say("none", () => collect(upTo(0)));
say("a generator that is left early", () => { for (const x of withFinally()) { if (x === 2) break; } return took(); });
say("a generator that is run out", () => { for (const _ of withFinally()) { } return took(); });
say("a generator that throws", () => collect(throwsAtSecond()));
say("yield*", () => collect(delegating()));
say("twice over the same one", () => { const g = upTo(3); return collect(g) + ";" + collect(g); });
say("one inside another", () => { const r: string[] = []; for (const a of upTo(3)) for (const b of upTo(a)) r.push(a + "" + b); return r.join(); });

// ---- the return value of next()
for (const [name, value] of [["undefined", undefined], ["null", null], ["a number", 5], ["a string", "s"], ["true", true], ["a symbol", Symbol.iterator], ["a bigint", 10n]] as [string, unknown][])
  say("next() hands back " + name, () => collect(scripted([value])) + took());
say("a function is an object", () => collect(scripted([Object.assign(() => 1, { done: false, value: "f" }), { done: true }])) + ";" + took());
say("an array is an object", () => collect(scripted([Object.assign([], { value: "arr" }), { done: true }])));
for (const [name, done] of [["1", 1], ["0", 0], ["''", ""], ["'no'", "no"], ["null", null], ["undefined", undefined], ["NaN", NaN], ["{}", {}], ["[]", []], ["0n", 0n], ["1n", 1n], ["-0", -0], ["a symbol", Symbol("d")]] as [string, unknown][])
  say("done is " + name, () => collect(scripted([{ done, value: "v" }, { done: true, value: "end" }])) + ";" + took());
say("no done at all", () => collect(scripted([{ value: 1 }, { value: 2 }, { done: true }])));
say("no value at all", () => collect(scripted([{ done: false }, { done: true }])));
say("value is not read at the end", () => { collect(scripted([{ get done() { log.push("done?"); return true; }, get value() { log.push("value?"); return 1; } }])); return took(); });
say("done before value", () => { collect(scripted([{ get value() { log.push("value?"); return 1; }, get done() { log.push("done?"); return false; } }, { done: true }])); return took(); });
say("done throws", () => collect(scripted([{ get done(): boolean { throw new EvalError("done"); } }])) + took());
say("value throws", () => collect(scripted([{ done: false, get value(): number { throw new EvalError("value"); } }])) + took());
say("inherited", () => collect(scripted([Object.create({ done: false, value: "up" }), Object.create({ done: true })])));
say("a proxy", () => collect(scripted([new Proxy({}, { get(_, k) { log.push("get " + String(k)); return k === "done" ? false : "p"; } }), { done: true }])) + ";" + took());
say("of many shapes", () => collect(scripted([{ done: false, value: 1 }, { value: 2, done: false }, { a: 0, done: false, value: 3 }, { value: 4 }, Object.assign(Object.create(null), { value: 5 }), { done: true }])));
class Result { constructor(public value: unknown, public done: boolean) { } }
say("of a class", () => collect(scripted([new Result(1, false), new Result(2, false), new Result(0, true)])));

// ---- next itself
say("next throws", () => collect({ [Symbol.iterator]() { return { next() { throw new URIError("next"); } }; } }));
say("next is not a function", () => collect({ [Symbol.iterator]() { return { next: 5 }; } }));
say("there is no next", () => collect({ [Symbol.iterator]() { return {}; } }));
say("no next, and nothing to go through", () => { for (const _ of any({ [Symbol.iterator]() { return {}; } })) return "in"; return "out"; });
say("next is read once", () => { let reads = 0; let i = 0; const it = { get next() { reads++; return () => ({ done: i++ > 2, value: i }); } }; return collect({ [Symbol.iterator]() { return it; } }) + ";" + reads; });
say("next is replaced meanwhile", () => { let i = 0; const it: any = { next() { it.next = () => ({ done: true }); return { done: i++ > 2, value: i }; } }; return collect({ [Symbol.iterator]() { return it; } }); });
say("next is inherited", () => { class It { i = 0; next() { return { done: this.i++ > 1, value: this.i }; } } return collect({ [Symbol.iterator]() { return new It(); } }); });
say("this of next", () => { const it = { tag: "me", n: 0, next(this: any) { return { done: this.n++ > 0, value: this.tag }; } }; return collect({ [Symbol.iterator]() { return it; } }); });
say("next gets nothing", () => { let n = -1; collect({ [Symbol.iterator]() { return { next() { n = arguments.length; return { done: true }; } }; } }); return n; });
say("next is bound", () => { const state = { i: 0 }; const next = function (this: any) { return { done: this.i++ > 1, value: this.i }; }.bind(state); return collect({ [Symbol.iterator]() { return { next }; } }); });
say("next is native", () => { const inner = [4, 5][Symbol.iterator](); return collect({ [Symbol.iterator]() { return { next: inner.next.bind(inner) }; } }); });
say("next is a proxy", () => { let i = 0; return collect({ [Symbol.iterator]() { return { next: new Proxy(function () { return { done: i++ > 1, value: i }; }, {}) }; } }); });
say("next is a class", () => collect({ [Symbol.iterator]() { return { next: class { } }; } }));
say("next is an arrow", () => { let i = 0; return collect({ [Symbol.iterator]: () => ({ next: () => ({ done: i++ > 1, value: i }) }) }); });
say("next is async", () => collect({ [Symbol.iterator]() { let i = 0; return { async next() { return { done: i++ > 1 }; } }; } }, 3));

// ---- @@iterator
for (const [name, value] of [["undefined", undefined], ["null", null], ["a number", 5], ["a string", "s"], ["true", true]] as [string, unknown][])
  say("@@iterator hands back " + name, () => collect({ [Symbol.iterator]() { return value; } }));
for (const [name, value] of [["undefined", undefined], ["null", null], ["a number", 5], ["an object", {}], ["a string", "s"]] as [string, unknown][])
  say("@@iterator is " + name, () => collect({ [Symbol.iterator]: value }));
say("@@iterator throws", () => collect({ [Symbol.iterator]() { throw new SyntaxError("open"); } }));
say("@@iterator is a getter", () => { const o = { get [Symbol.iterator]() { log.push("read"); return function* () { yield 1; }; } }; return collect(o) + ";" + took(); });
say("this of @@iterator", () => { const o = { tag: "it", [Symbol.iterator](this: any) { const t = this.tag; let d = false; return { next() { const r = { done: d, value: t }; d = true; return r; } }; } }; return collect(o); });
for (const [name, value] of [["undefined", undefined], ["null", null], ["a number", 5], ["true", true], ["an object", {}], ["a function", () => 1], ["a symbol", Symbol()], ["a bigint", 1n]] as [string, unknown][])
  say("over " + name, () => collect(value));
say("on a primitive's prototype", () => { any(Number.prototype)[Symbol.iterator] = function* (this: unknown) { yield typeof this; }; try { return collect(5); } finally { delete any(Number.prototype)[Symbol.iterator]; } });

// ---- closing
const closable = (n: number, ret: unknown) => scripted(Array.from({ length: n }, (_, i) => ({ done: false, value: i })), { return: ret });
say("break closes", () => { for (const x of any(closable(5, function () { log.push("return"); return {}; }))) { if (x === 1) break; } return took(); });
say("return closes", () => { const f = () => { for (const x of any(closable(5, function () { log.push("return"); return {}; }))) { if (x === 1) return "left"; } return "ran out"; }; return f() + ";" + took(); });
say("throw closes", () => { try { for (const x of any(closable(5, function () { log.push("return"); return {}; }))) { if (x === 1) throw new Error("body"); } } catch (e: any) { log.push("caught " + e.message); } return took(); });
say("continue does not", () => { let n = 0; for (const x of any(scripted([{ value: 1 }, { value: 2 }, { done: true }], { return() { log.push("return"); return {}; } }))) { n += x; continue; } return n + ";" + took(); });
say("running out does not", () => { collect(scripted([{ done: true }], { return() { log.push("return"); return {}; } })); return took(); });
say("a labelled break closes both", () => { outer: for (const _ of any(closable(3, function () { log.push("outer"); return {}; }))) for (const __ of any(closable(3, function () { log.push("inner"); return {}; }))) break outer; return took(); });
say("return hands back a number", () => { for (const _ of any(closable(2, () => 5))) break; return "left"; });
say("return hands back a number, after a throw", () => { for (const _ of any(closable(2, () => 5))) throw new Error("body wins"); });
say("return throws", () => { for (const _ of any(closable(2, () => { throw new RangeError("return"); }))) break; return "left"; });
say("return throws, after a throw", () => { for (const _ of any(closable(2, () => { throw new RangeError("return"); }))) throw new Error("body wins"); });
say("return is not a function", () => { for (const _ of any(closable(2, 5))) break; return "left"; });
say("return is null", () => { for (const _ of any(closable(2, null))) break; return "left"; });
say("return is undefined", () => { for (const _ of any(closable(2, undefined))) break; return "left"; });
say("next threw: no closing", () => { try { for (const _ of any({ [Symbol.iterator]() { return { next() { throw new Error("n"); }, return() { log.push("return"); return {}; } }; } })) { } } catch { log.push("caught"); } return took(); });
say("not an object: no closing", () => { try { for (const _ of any(scripted([5], { return() { log.push("return"); return {}; } }))) { } } catch { log.push("caught"); } return took(); });
say("this of return", () => { let same = false; const it: any = { next() { return { done: false }; }, return() { same = this === it; return {}; } }; for (const _ of any({ [Symbol.iterator]() { return it; } })) break; return same; });
say("destructuring closes", () => { const [a] = any(closable(3, function () { log.push("return"); return {}; })); return a + ";" + took(); });
say("destructuring that runs out does not", () => { const [a, b] = any(scripted([{ value: 1 }, { done: true }], { return() { log.push("return"); return {}; } })); return a + "," + b + ";" + took(); });

// ---- arrays whose iterators can be told from nothing, and cannot
say("break out of an array", () => { let s = 0; for (const x of [1, 2, 3, 4]) { if (x > 2) break; s += x; } return s; });
say("an array that grows", () => { const a = [1, 2]; const r: number[] = []; for (const x of a) { r.push(x); if (a.length < 5) a.push(x + 10); } return r.join(); });
say("an array that shrinks", () => { const a = [1, 2, 3, 4]; const r: number[] = []; for (const x of a) { r.push(x); a.pop(); } return r.join(); });
say("holes", () => collect([1, , 3]));
say("holes with something behind them", () => { any(Object.prototype)[1] = "behind"; try { return collect([1, , 3]); } catch (e: any) { return e.name; } finally { delete any(Object.prototype)[1]; } });
say("doubles", () => collect([1.5, 2.5]));
say("of everything", () => collect([1, "a", null, undefined, {}, [2], 1.5, true]));
say("entries", () => collect([5, 6].entries()));
say("keys", () => collect([5, 6].keys()));
say("values", () => collect([5, 6].values()));
say("half way through", () => { const it = [1, 2, 3][Symbol.iterator](); it.next(); return collect(it); });
say("array iterators are given a return", () => {
  const proto = Object.getPrototypeOf([][Symbol.iterator]());
  try { proto.return = function () { log.push("return"); return {}; }; } catch (e: any) { return "cannot: " + e.name; }
  try { for (const x of [1, 2, 3]) { if (x === 2) break; } return took() || "was not called"; } finally { delete proto.return; }
});
say("and it is taken away again", () => { for (const x of [1, 2, 3]) { if (x === 2) break; } return took() || "was not called"; });

// ---- what else can be gone through
say("a map", () => collect(new Map([["a", 1], ["b", 2]])));
say("a map's keys", () => collect(new Map([["a", 1]]).keys()));
say("a set", () => collect(new Set([3, 1, 3, 2])));
say("a set that is added to", () => { const s = new Set([1]); const r: number[] = []; for (const x of s) { r.push(x); if (x < 4) s.add(x + 1); } return r.join(); });
say("a string", () => collect("a\u{1F600}b"));
say("arguments", () => (function (..._: unknown[]) { return collect(arguments); })(1, 2, 3));
say("a typed array", () => collect(new Uint8Array([1, 2, 300])));
say("a subclass of Array", () => { class A extends Array<number> { } return collect(A.from([1, 2])); });
say("a subclass of Map", () => { class M extends Map<string, number> { *[Symbol.iterator](): any { yield "mine"; } } return collect(new M([["a", 1]])); });
say("matchAll", () => collect("a1b2".matchAll(/\d/g)));
say("Object.entries", () => collect(Object.entries({ a: 1, b: 2 })));
say("iterator helpers", () => typeof any(upTo(1)).map === "function" ? collect(any(upTo(5)).map((x: number) => x * 2).filter((x: number) => x > 2)) : "none");

// ---- positions in stack traces
const where = (e: any) => String(e.stack).split("\n").slice(0, 5).map((l: string) => l.trim().replace(/\(?[^ ()]*[\\/]/g, "").replace(/:\d+:\d+\)?$/, "")).join(" < ");
function goesThrough(it: any) { for (const x of it) { void x; } }
function callsThat(it: any) { goesThrough(it); return 1; }
say("the stack, from next", () => { try { callsThat({ [Symbol.iterator]() { return { next: function nextOfMine() { throw new Error("n"); } }; } }); } catch (e) { return where(e); } });
// (A declaration, so that it has its name from the start. A function that is named by a computed key when the object is created shows as <anonymous> in a stack trace of compiled code: a known, unrelated issue.)
function opens(): never { throw new Error("o"); }
say("the stack, from @@iterator", () => { try { callsThat({ [Symbol.iterator]: opens }); } catch (e) { return where(e); } });
say("the stack, from a getter of done", () => { try { callsThat(scripted([{ get done(): boolean { throw new Error("d"); } }])); } catch (e) { took(); return where(e); } });
say("the stack, not an object", () => { try { callsThat(scripted([1])); } catch (e) { took(); return where(e); } });
say("the stack, not iterable", () => { try { callsThat(5); } catch (e) { return where(e); } });
say("the stack, seen from next", () => { let s = ""; callsThat({ [Symbol.iterator]() { return { next: function looks() { s = where(new Error("look")); return { done: true }; } }; } }); return s; });

// ---- caught in the same function, and the values that stay live meanwhile
say("caught in the same function", () => { let s = "", kept = "kept"; const local = [1, 2, 3]; try { for (const x of any(scripted([{ value: "a" }, 5]))) s += x; } catch (e: any) { s += "!" + e.name; } took(); return s + kept + local.join(""); });
say("caught, and gone on with", () => { const r: string[] = []; for (let i = 0; i < 3; i++) { try { for (const x of any(scripted([{ value: i }, i === 1 ? null : { done: true }]))) r.push("v" + x); } catch { r.push("c" + i); } } took(); return r.join(); });
say("finally", () => { const r: string[] = []; try { for (const x of throwsAtSecond()) r.push(x); } catch { r.push("caught"); } finally { r.push("finally"); } return r.join(); });
say("much is alive across it", () => { const a = { v: 1 }, b = [2], c = "3", d = 4.5, e = 5n, f = Symbol.for("6"), g = () => 7, h = new Map([[8, 8]]); let s = 0; for (const x of upTo(4)) s += x + a.v + b[0] + c.length + d + Number(e) + f.description!.length + g() + h.size; return s; });
say("garbage is made meanwhile", () => { let n = 0; for (const x of (function* () { for (let i = 0; i < 300; i++) yield { i, pad: new Array(50).fill(i) }; })()) n += x.pad[49] + x.i; return n; });
say("results that die young", () => { let i = 0, n = 0; for (const x of any({ [Symbol.iterator]() { return { next() { return { done: i++ >= 2000, value: { v: [i, String(i)] } }; } }; } })) n += x.v[0] + x.v[1].length; return n; });

// ---- deep
say("an iterator that goes through itself", () => { const deep = (n: number): number => { let s = 0; for (const x of (function* () { yield n > 0 ? deep(n - 1) : 0; })()) s += x + 1; return s; }; return deep(200); });
say("too deep", () => { const it: any = { [Symbol.iterator]() { return { next() { for (const _ of it) { } return { done: true }; } }; } }; try { for (const _ of it) { } return "came back"; } catch (e: any) { return e.name; } });
say("and all is well afterwards", () => collect(upTo(3)));

// ---- repeatedly, so that the inline caches warm up, and then with something else
say("the same place, many kinds", () => { const kinds: any[] = [[1], upTo(1), new Set([1]), "1", new Map([[1, 1]]).keys(), scripted([{ value: 1 }, { done: true }]), new Uint8Array([1]), [1].values()]; let s = ""; for (let round = 0; round < 3; round++) for (const k of round ? [[1], new Set([1]), "1", scripted([{ value: 1 }, { done: true }])] : kinds) for (const x of k) s += x; took(); return s; });
say("hot", () => { let s = 0; for (let i = 0; i < 3000; i++) for (const x of upTo(3)) s += x; return s; });
say("hot, of a class", () => { class Range { constructor(private n: number) { } [Symbol.iterator]() { let i = 0; const n = this.n; return { next: () => i < n ? { done: false, value: i++ } : { done: true, value: undefined } }; } } let s = 0; for (let i = 0; i < 3000; i++) for (const x of new Range(3)) s += x!; return s; });
console.log(out.join("\n"));
