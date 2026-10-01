const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
function show(this: any, ...xs: any[]) { return (this === undefined ? "u" : this === null ? "n" : typeof this === "object" ? this.k : String(this)) + "|" + xs.length + "|" + xs.join(); }
function counts(this: any, a?: any, b?: any) { return arguments.length + ":" + a + ":" + b + ":" + this?.k; }
function five(this: any, a: any, b: any, c: any, d: any, e: any) { return [this?.k, a, b, c, d, e].map(String).join(); }
function none(this: any) { return this?.k; }
const o = { k: "o" };

// ---- so many bound, so many passed
for (let bound = 0; bound <= 6; bound++) {
  const args = Array.from({ length: bound }, (_, i) => "b" + i);
  const fs = [show, counts, five, none].map(f => (f as any).bind(o, ...args));
  for (let passed = 0; passed <= 5; passed++) {
    const more = Array.from({ length: passed }, (_, i) => "p" + i);
    say(`${bound} bound, ${passed} passed`, () => fs.map(f => f(...more)).join(" / "));
  }
  say(`${bound} bound, written out`, () => [fs[0](), fs[0](1), fs[0](1, 2), fs[0](1, 2, 3), fs[2](1), fs[2](1, 2, 3, 4, 5, 6, 7)].join(" / "));
  say(`${bound} bound: name and length`, () => fs.map(f => f.name + f.length).join());
}
say("many bound", () => (show as any).bind(o, ...Array.from({ length: 200 }, (_, i) => i))(1, 2).length);
say("many passed", () => show.bind(o, "b")(...Array.from({ length: 300 }, (_, i) => i)).length);

// ---- this
say("this", () => [show.bind(undefined)(), show.bind(null)(), show.bind(5)(), show.bind("s")(), show.bind(o)(), show.bind(true)()].join(" / "));
say("this is not what it is called on", () => { const h = { k: "h", f: show.bind(o) }; return h.f() + " / " + h.f.call({ k: "c" }) + " / " + h.f.apply({ k: "a" }, [1]) + " / " + Reflect.apply(h.f, { k: "r" }, [1, 2]); });
say("arrow", () => { const a = (() => (x: any) => x + 1)(); return a.bind(o)(1) + "," + a.bind(o, 5)(); });
say("method", () => { class C { k = "c"; m(a: any) { return this.k + a; } } const c = new C(); const m = c.m.bind(c); return m(1) + [1, 2].map(m).join(); });

// ---- bound again
say("bound twice", () => show.bind(o, 1).bind({ k: "x" }, 2)(3));
say("bound five times", () => { let f: any = show; for (let i = 0; i < 5; i++) f = f.bind({ k: "k" + i }, i); return f("z"); });
say("bound often", () => { let f: any = counts; for (let i = 0; i < 300; i++) f = f.bind(o); return f(1, 2); });

// ---- other targets
say("native", () => [Math.max.bind(null, 3)(1, 7), Array.prototype.join.bind([1, 2], "-")(), String.prototype.slice.bind("hello", 1)(3), Object.prototype.hasOwnProperty.bind(o)("k")].join());
say("Function.prototype.call", () => Function.prototype.call.bind(show)(o, 1, 2));
say("Function.prototype.apply", () => Function.prototype.apply.bind(show)(o, [1, 2]));
say("proxy", () => new Proxy(show, {}).bind(o, 1)(2));
say("proxy with apply", () => new Proxy(show, { apply: (t, th, a) => "trapped" + a.length }).bind(o, 1)(2));
say("class", () => { class K { constructor(public a: any) {} } return (K as any).bind(null, 1)(); });
say("class constructed", () => { class K { constructor(public a: any, public b: any) {} } const B = (K as any).bind(null, 1); const k = new B(2); return k.a + "," + k.b + "," + (k instanceof K) + "," + (k instanceof B); });
say("function constructed", () => { function F(this: any, a: any, b: any) { this.s = a + b; } const B = (F as any).bind({ ignored: 1 }, "x"); return new B("y").s + "," + (new B("y") instanceof F); });
say("new.target", () => { function F(this: any) { return { t: new.target === F }; } return new ((F as any).bind(null))().t + "," + (F as any).bind(null)().t; });
say("arrow constructed", () => new ((() => 1) as any).bind(null)());
say("generator", () => { function* g(this: any, a: any, b: any) { yield this.k; yield a; yield b; } return [...g.bind(o, 1)(2)].join(); });
const asyncResults: Promise<string>[] = [];
{ async function a(this: any, x: any, y: any) { await null; return this.k + x + y; } asyncResults.push(a.bind(o, 1)(2)); }
{ async function* g(this: any, x: any) { yield this.k; yield x; } asyncResults.push((async () => { const r = []; for await (const v of g.bind(o, 7)()) r.push(v); return r.join(); })()); }
say("eval'd", () => (0, eval)("(function (a, b) { return this.k + a + b })").bind(o, 1)(2));
say("new Function", () => new Function("a", "b", "return this.k + a + b").bind(o, 1)(2));

// ---- called by native code, and in tail position
say("map", () => [1, 2, 3].map(show.bind(o, "b")).join(" / "));
say("forEach, sort, reduce", () => { const r: any[] = []; [3, 1].forEach(((x: any) => r.push(x)).bind(null)); return r + "|" + [3, 1, 2].sort(((a: number, b: number) => a - b).bind(null)) + "|" + [1, 2].reduce(((k: number, a: number, x: number) => a + x * k).bind(null, 10), 0); });
say("replace", () => "a1b2".replace(/\d/g, ((p: string, m: string) => p + m).bind(null, "#")));
say("JSON", () => JSON.stringify({ a: 1 }, ((p: string, k: string, v: any) => (typeof v === "number" ? p + v : v)).bind(null, "n")));
say("toString, valueOf", () => `${{ toString: (function (this: any) { return this.k; }).bind(o) }}` + +{ valueOf: (() => 4).bind(null) });
say("getter", () => Object.defineProperty({}, "g", { get: (function (this: any) { return this.k; }).bind(o) }).g);
const boundShow = show.bind(o, "t");
function tail(a: any) { return boundShow(a); }
function tailTwice(a: any) { return tail(a); }
say("tail", () => tail(1) + " / " + tailTwice(2));
const boundCount: any = (function count(n: number, acc: number): any { return n ? boundCount(n - 1, acc + 1) : acc; }).bind(null);
// (Whether that many calls fit on the stack depends on whether the call through the bound function reuses the caller's frame. With the JIT,
// that depends on how soon the function is compiled by a tier that does so. Both outcomes are correct. A crash is not.)
say("deep, in tail position", () => { try { return boundCount(200_000, 0) === 200_000 ? "all of them, or too many" : "wrong"; } catch (e: any) { return e.name === "RangeError" ? "all of them, or too many" : e.name; } });

// ---- errors
function thrower(this: any, a: any) { throw new RangeError("from " + this.k + a); }
say("throws", () => thrower.bind(o, 1)());
say("caught and called again", () => { const b = thrower.bind(o); let n = 0; for (let i = 0; i < 5; i++) { try { b(i); } catch { n++; } } return n; });
say("stack", () => { function inner() { return new Error("s").stack!.split("\n").slice(1, 4).map(l => l.trim().split(" ")[1]).join(">"); } function outer() { const r = inner.bind(null)(); return r; } const r = outer(); return r; });
say("finally", () => { const log: string[] = []; try { try { thrower.bind(o)(1); } finally { log.push("f"); } } catch (e: any) { log.push(e.message); } return log.join(); });
const forever: any = (function again(this: any, n: number): number { return 1 + forever(n + 1); }).bind(o);
say("no room", () => { try { return forever(0); } catch (e: any) { return e.name + ":" + e.message; } });
say("no room, then fine", () => { try { forever(0); } catch {} return show.bind(o, 1)(2); });
say("no room, many arguments", () => { const wide: any = (function w(this: any, ...xs: any[]): number { return 1 + wide(...xs); }).bind(o, ...Array.from({ length: 50 }, (_, i) => i)); try { return wide(1, 2, 3); } catch (e: any) { return e.name; } });
say("not a function", () => (Function.prototype.bind as any).call({}, o));

// ---- collected in the middle
say("gc", () => { function g(this: any, a: any, b: any) { Bun.gc(true); return this.k + a.v + b.v; } return g.bind({ k: "fresh" }, { v: 1 })({ v: 2 }); });
say("gc, many", () => { function g(this: any, ...xs: any[]) { Bun.gc(true); return xs.map(x => x.v).join(""); } return (g as any).bind(o, ...[1, 2, 3, 4, 5, 6].map(v => ({ v })))({ v: 7 }); });
say("hot", () => { const b = counts.bind(o, 1); let s = 0; for (let i = 0; i < 300_000; i++) s += b(i).length; return s; });
for (const r of await Promise.all(asyncResults)) out.push("async = " + r);
await Promise.resolve(3).then(show.bind(o, "then")).then(v => out.push("then = " + v));
await new Promise<void>(r => setTimeout(((a: string) => { out.push("timer = " + a); r(); }).bind(null, "x"), 0));
queueMicrotask((() => out.push("microtask")).bind(null));
await null;
console.log(out.join("\n"));
// A function that the program never constructs, constructed from native code: checks the stack trace in that case.
{
  const lines = (e: unknown) => String((e as Error).stack).split("\n").slice(0, 4).map(l => l.trim().replace(/\(?[^ ()]*[\\/]/, "").replace(/\)$/, "")).join(" < ");
  function Plain(this: any, x: number) { this.x = x; this.where = lines(new Error("made in Plain")); }
  function Thrower(this: any, x: number) { this.x = x; if (x) throw new RangeError("thrown in Thrower"); }
  function Outer(this: any, x: number) { this.inner = Reflect.construct(Plain, [x]); }
  const attempt = (f: () => unknown) => { try { return JSON.stringify(f()); } catch (e) { return "throws " + lines(e); } };
  console.log("constructed from outside:", attempt(() => Reflect.construct(Plain, [1])));
  console.log("throws when constructed from outside:", attempt(() => Reflect.construct(Thrower, [1])));
  console.log("one in another:", attempt(() => Reflect.construct(Outer, [2])));
  await Promise.resolve().then(() => console.log("in a microtask:", attempt(() => Reflect.construct(Plain, [3]))));
  await Promise.resolve().then(() => console.log("throws in a microtask:", attempt(() => Reflect.construct(Thrower, [4]))));
  await (async () => { await null; console.log("in an async function:", attempt(() => Reflect.construct(Outer, [5]))); })();
  await (async () => { await null; console.log("throws in an async function:", attempt(() => [1].map(() => Reflect.construct(Thrower, [6])))); })();
  await new Promise<void>(r => setTimeout(() => { console.log("in a timer:", attempt(() => Reflect.construct(Outer, [7]))); r(); }, 0));
  // Ones that make nothing of `this`, which are compiled to be called and that is all.
  const plainly = (t: string) => t.replace(/at new /g, "at ");
  function NoThis(x: number) { return { x, where: lines(new Error("made in NoThis")) }; }
  function ThrowsNoThis(x: number) { if (x) throw new RangeError("thrown in ThrowsNoThis"); return {}; }
  // (Not `return Reflect.construct(...)`: compiled to be called, that is a tail call, and the frame would not be in the stack trace.)
  function Deep(x: number): object { const made = x ? Reflect.construct(Deep, [x - 1]) : Reflect.construct(ThrowsNoThis, [1]); return made; }
  console.log("nothing of this:", plainly(attempt(() => Reflect.construct(NoThis, [1]))));
  console.log("nothing of this, throws:", plainly(attempt(() => Reflect.construct(ThrowsNoThis, [1]))));
  console.log("nothing of this, deep:", plainly(attempt(() => Reflect.construct(Deep, [2]))));
  await (async () => { await null; console.log("nothing of this, in an async function:", plainly(attempt(() => Reflect.construct(NoThis, [5])))); })();
  await (async () => { await null; console.log("nothing of this, throws in an async function:", plainly(attempt(() => Reflect.construct(ThrowsNoThis, [6])))); })();
  await (async () => { await null; console.log("nothing of this, deep in an async function:", plainly(attempt(() => Reflect.construct(Deep, [2])))); })();
  await Promise.resolve().then(() => console.log("nothing of this, and goes on:", plainly(attempt(() => { try { Reflect.construct(Deep, [3]); } catch { return Reflect.construct(NoThis, [8]); } }))));
}
