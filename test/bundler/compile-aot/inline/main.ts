import { fromOther, throwsInOther, callsBack, bumps, counter } from "./other";
const any = (x: unknown): any => x;
const where = (e: any) => String(e.stack).split("\n").slice(0, 6).map((l: string) => l.trim().replace(/\(?[^ ()]*[\\/]/g, "")).join(" < ");
const say = (label: string, f: () => unknown) => { let r; try { r = JSON.stringify(f()); } catch (e: any) { r = "throws " + e; } console.log(label + " -> " + r); };

// Called from one place.
function once(a: number, b: number) { const c = a + b; return c * 2; }
say("once", () => once(1, 2));
// Little, called from several.
function little(a: number) { return a + 1; }
say("little", () => little(1) + little(2) + little(little(3)));
// Fewer arguments than parameters, and more.
function three(a: any, b: any, c: any) { return [a, b, c]; }
say("fewer", () => three(1));
function threeAgain(a: any, b: any, c: any) { return [a, b, c]; }
say("more", () => any(threeAgain)(1, 2, 3, 4));
function threeMore(a: any, b: any, c: any) { return [a, b, c]; }
say("more, known", () => (threeMore as any)(1, 2, 3, sideEffect()));
let effects = 0; function sideEffect() { return ++effects; }
say("its arguments were evaluated", () => effects);
// One in another in another.
function inner(x: number) { return x * 2; }
function middle(x: number) { return inner(x) + 1; }
function outer(x: number) { return middle(x) * 3; }
say("nested", () => outer(5));
// Several ways out.
function ways(x: number) { if (x < 0) return "negative"; if (x === 0) return "zero"; return x > 10 ? "big" : "small"; }
say("ways", () => [ways(-1), ways(0), ways(5), ways(50)]);
function noResult(o: { n: number }) { o.n++; }
say("no result", () => { const o = { n: 1 }; noResult(o); const r = noResult(o); return [o.n, r === undefined]; });
// A loop in it, and it in a loop.
function sums(n: number) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }
say("has a loop", () => sums(10));
function square(n: number) { return n * n; }
say("in a loop", () => { let s = 0; for (let i = 0; i < 100; i++) s += square(i); return s; });
// It calls itself.
function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }
say("recursive", () => fact(10));
function ping(n: number): number { return n <= 0 ? 0 : pong(n - 1) + 1; }
function pong(n: number): number { return n <= 0 ? 0 : ping(n - 1) + 1; }
say("mutually", () => ping(9));
// What goes wrong in it.
function throwsHere(x: any) { return x.missing.deeper; }
say("throws", () => throwsHere({}));
function throwsForStack(x: any) { return x.missing.deeper; }
function callsWhatThrows(x: any) { return throwsForStack(x) + 1; }
say("where", () => { try { return callsWhatThrows({}); } catch (e) { return where(e); } });
const made: Error[] = [];
function makesError() { const e = new Error("made"); made.push(e); return e; }
function callsWhatMakes() { const e = makesError(); made.push(e); return e; }
say("where it was made", () => where(callsWhatMakes()));
function notAFunction(x: any) { return x.nothing(1); }
say("quotes", () => notAFunction({}));
// Caught by the caller.
function mayThrow(x: number) { if (x > 1) throw new TypeError("too much: " + x); return x; }
say("caught", () => { let seen = 0; let local = "before"; try { seen = mayThrow(1); local = "between"; seen += mayThrow(2); local = "after"; } catch (e: any) { return [seen, local, e.message]; } return "no"; });
function mayThrowInLoop(x: number) { if (x === 3) throw new TypeError("three"); return x; }
say("caught in a loop", () => { let s = 0; for (let i = 0; i < 6; i++) { try { s += mayThrowInLoop(i); } catch { s += 100; } } return s; });
function withFinally(x: number) { if (x) throw new Error("finally"); return 1; }
say("finally", () => { const log: string[] = []; try { try { withFinally(1); } finally { log.push("f"); } } catch (e: any) { log.push(e.message); } return log; });
// A call in tail position in it.
function tailOf(x: number) { return lastOne(x + 1); }
function lastOne(x: number) { return x * 7; }
say("tail", () => tailOf(1) + 1);
function tailUnknown(f: any, x: number) { return f(x); }
say("tail of who knows", () => tailUnknown((v: number) => v + 5, 1) * 2);
say("tail of nothing", () => tailUnknownAgain(undefined, 1));
function tailUnknownAgain(f: any, x: number) { return f(x); }
// this.
function usesThis(this: any) { return typeof this; }
say("this", () => usesThis());
// Variables of the module.
let total = 0;
function adds(n: number) { total += n; return total; }
say("module variable", () => [adds(1), adds(2), total]);
// From another module.
say("other module", () => fromOther(1, 2));
say("other module throws", () => { try { throwsInOther("x"); } catch (e) { return where(e); } });
say("other module, deeper", () => callsBack(2));
say("other module's variable", () => [bumps(), bumps(), counter]);
// Spread and rest stay calls.
function rests(...all: number[]) { return all.length; }
say("rest", () => rests(1, 2, 3));
function argumentsOf() { return arguments.length; }
say("arguments", () => (argumentsOf as any)(1, 2));
// Closures made in it.
function makes(n: number) { return () => n + 1; }
say("closure", () => makes(1)());
// Objects and strings.
function point(x: number, y: number) { return { x, y }; }
say("object", () => point(1, 2));
function joins(a: string, b: string) { return a + "-" + b; }
say("strings", () => joins("a", "b") + joins("c", "d"));
function typed(a: number, b: boolean, c: string) { return b ? a + c.length : -a; }
say("typed", () => [typed(1, true, "xy"), typed(2.5, false, "")]);
function checks(a: number) { return a; }
say("wrong type", () => checks(any("s")));
function deep(n: number): number { return n ? deep(n - 1) + littleAgain(n) : 0; }
function littleAgain(n: number) { return n & 1; }
say("stack overflow", () => { try { return deep(1e7); } catch (e: any) { return e.constructor.name; } });

// Closures that are called where they are created.
say("called at once", () => (() => 41 + 1)());
say("called at once, with arguments", () => ((a: number, b: number) => a * b)(6, 7));
say("closes over", () => { const k = 10; return ((x: number) => x + k)(5); });
say("writes what it closes over", () => { let n = 1; (() => { n += 5; })(); (() => { n *= 2; })(); return n; });
say("held in a variable", () => { const twice = (x: number) => x * 2; return twice(4) + twice(5); });
say("this of an arrow", function (this: any) { return (() => typeof this)(); });
say("function expression", () => (function (a: number) { return a + 1; })(1));
say("named function expression", () => (function again(a: number): number { return a ? again(a - 1) + 1 : 0; })(4));
say("throws at once", () => { try { return (() => { throw new Error("in it"); })(); } catch (e) { return where(e); } });
say("closure in a closure", () => ((a: number) => ((b: number) => a + b)(2))(1));
say("in a loop, closing over the variable", () => { const fs: (() => number)[] = []; for (let i = 0; i < 3; i++) { ((j: number) => { fs.push(() => i * 10 + j); })(i + 1); } return fs.map(f => f()); });
say("escapes as well", () => { const f = (x: number) => x + 1; return [f(1), [1, 2].map(f)]; });
// Features that depend on which function is running.
function switches(s: string) { switch (s) { case "one": return 1; case "two": return 2; case "three": return 3; case "four": return 4; default: return -1; } }
say("switch on strings", () => [switches("one"), switches("three"), switches("nine")]);
function switchesOnce(n: number) { switch (n) { case 0: return "a"; case 1: return "b"; case 2: return "c"; case 3: return "d"; case 4: return "e"; default: return "?"; } }
say("switch on numbers", () => switchesOnce(3) + "!");
function matches(s: string) { return /^a+b$/.test(s); }
say("regular expression", () => [matches("aab"), matches("b")]);
function list() { return [1, 2, 3]; }
say("array of constants", () => { const a = list(); a.push(4); return [a, list()]; });
function makesClosures(n: number) { const add = (x: number) => x + n; return { add, get: () => n }; }
say("makes closures", () => { const o = makesClosures(3); return [o.add(1), o.get()]; });
function template(a: number) { return `<${a}>`; }
say("template", () => template(1) + template(2));
function destructures({ a, b = 2 }: { a: number; b?: number }) { return a + b; }
say("destructures", () => [destructures({ a: 1 }), destructures({ a: 1, b: 5 })]);
function optional(o?: { v?: number }) { return o?.v ?? "none"; }
say("optional", () => [optional(), optional({}), optional({ v: 0 })]);
// Methods of arrays that are passed a closure made on the spot.
const nums = [1, 2, 3, 4, 5];
say("map", () => nums.map(x => x * 2));
say("map with index and array", () => nums.map((x, i, a) => x + i + a.length));
say("filter", () => nums.filter(x => x & 1));
say("forEach", () => { let s = 0; nums.forEach(x => { s += x; }); return s; });
say("reduce", () => nums.reduce((a, b) => a + b, 10));
say("reduce without a start", () => nums.reduce((a, b) => a * b));
say("reduce of nothing", () => ([] as number[]).reduce((a, b) => a + b));
say("reduceRight", () => nums.reduceRight((a, b) => a + "" + b, ""));
say("some and every", () => [nums.some(x => x > 4), nums.some(x => x > 5), nums.every(x => x > 0), nums.every(x => x > 1)]);
say("find", () => [nums.find(x => x > 2), nums.find(x => x > 9), nums.findIndex(x => x > 2), nums.findIndex(x => x > 9), nums.findLast(x => x < 4), nums.findLastIndex(x => x < 4)]);
say("flatMap", () => nums.flatMap(x => [x, [x]]));
say("chained", () => nums.filter(x => x > 1).map(x => x * x).reduce((a, b) => a + b, 0));
say("nested", () => nums.map(x => nums.filter(y => y < x).length));
say("closes over", () => { const k = 100; let calls = 0; const r = nums.map(x => { calls++; return x + k; }); return [r, calls]; });
say("with this", () => nums.map(function (this: any, x) { return x + this.k; }, { k: 7 }));
say("this of an arrow in it", function (this: any) { return nums.map(() => typeof this); });
say("holes", () => { const a = [1, , 3] as number[]; let seen = 0; a.forEach(() => { seen++; }); return [a.map(x => x * 2), seen, a.filter(() => true), 1 in a.map(x => x)]; });
say("grows while it is gone through", () => { const a = [1, 2, 3]; const seen: number[] = []; a.forEach(x => { seen.push(x); if (a.length < 6) a.push(x * 10); }); return [seen, a]; });
say("shrinks while it is gone through", () => { const a = [1, 2, 3, 4]; const seen: number[] = []; a.forEach(x => { seen.push(x); a.pop(); }); return [seen, a]; });
say("throws in it", () => { try { return nums.map(x => { if (x === 3) throw new RangeError("three"); return x; }); } catch (e) { return where(e); } });
say("error made in it", () => where(nums.map(() => { const e = new Error("in map"); made.push(e); return e; })[0]));
say("caught in it", () => nums.map(x => { try { if (x & 1) throw x; return 0; } catch (e) { return -(e as number); } }));
say("makes closures", () => nums.map(x => () => x * 3).map(f => f()));
say("in a loop", () => { let t = 0; for (let i = 0; i < 50; i++) t += nums.map(x => x + i).length + nums.filter(x => x > i).length; return t; });
say("returns early", () => { const seen: number[] = []; nums.some(x => { seen.push(x); return x === 2; }); return seen; });
say("async", () => nums.map(async x => x).length);
say("uses arguments", () => nums.map(function () { return arguments.length; }));
say("rest", () => nums.map((...all) => all.length));
say("default", () => nums.map((x, i = 5, a = 1 as any) => typeof a + i + x));
say("destructures its parameter", () => [{ a: 1 }, { a: 2 }].map(({ a }) => a));
say("strings", () => ["a", "b"].map(s => s + s).join());
say("empty", () => [([] as number[]).map(x => x), ([] as number[]).every(x => !!x), ([] as number[]).some(x => !!x)]);
// By the same names, and not those.
class Box<T> { constructor(public v: T) {} map<U>(f: (v: T) => U) { return new Box(f(this.v)); } forEach(f: (v: T) => void) { f(this.v); f(this.v); } filter(f: (v: T) => boolean) { return f(this.v) ? "kept" : "dropped"; } }
say("a class of my own", () => { let n = 0; const b = new Box(4); b.forEach(v => { n += v; }); return [b.map(v => v + 1).v, n, b.filter(v => v > 9)]; });
say("a Map and a Set", () => { const out: any[] = []; new Map([[1, "a"]]).forEach((v, k) => { out.push(k, v); }); new Set([7]).forEach(v => { out.push(v); }); return out; });
say("a typed array", () => [Array.from(new Uint8Array([1, 2, 300]).map(x => x * 2)), Array.from(new Float64Array([1.5]).filter(x => x > 1)), new Int8Array([1, 2]).reduce((a, b) => a + b, 0)]);
class Sub extends Array<number> { total() { return this.reduce((a, b) => a + b, 0); } }
say("a subclass of Array", () => { const s = Sub.from([1, 2, 3]) as Sub; const m = s.map(x => x * 2); return [m instanceof Sub, (m as Sub).total(), s.filter(x => x > 1) instanceof Sub]; });
say("an array with a method of its own", () => { const a: any = [1, 2]; a.map = (f: any) => "mine " + f(1); return a.map((x: number) => x + 1); });
say("something like an array", () => Array.prototype.map.call({ length: 2, 0: "x", 1: "y" }, (s: any) => s + s));
say("an object with map", () => ({ map: (f: (n: number) => number) => f(20) }).map(n => n + 1));
say("nothing", () => any(undefined).map((x: number) => x));
say("no such method", () => any({}).map((x: number) => x));
say("either", () => [nums, new Box(1)].map(o => JSON.stringify((o as any).map((x: number) => x + 1))));
say("species", () => { class Odd extends Array<number> { static get [Symbol.species]() { return Array; } } const o = Odd.from([1, 2]) as Odd; return [o.map(x => x) instanceof Odd, Array.isArray(o.map(x => x))]; });
say("a proxy", () => { const log: string[] = []; const p = new Proxy([1, 2], { get(t, k, r) { if (typeof k === "string") log.push(k); return Reflect.get(t, k, r); }, has(t, k) { log.push("has " + String(k)); return Reflect.has(t, k); } }); return [p.map(x => x + 1), log]; });
say("frozen", () => Object.freeze([1, 2]).map(x => x + 1));
say("sparse and long", () => { const a: number[] = []; a[1000] = 1; let n = 0; a.forEach(() => { n++; }); return [n, a.map(x => x).length]; });
// What goes wrong with a call in what has been made part of another.
function tailInIt(x: any) { return x.nothing(1); }
function callInIt(x: any) { const r = x.nothing(1); return r; }
function tailInItAgain(x: any) { return x.nothing(1); }
function callInItAgain(x: any) { const r = x.nothing(1); return r; }
function newInIt(x: any) { const r = new x.nothing(1); return r; }
say("a tail call in it, called by a tail call", () => tailInIt({}));
say("a call in it, called by a tail call", () => callInIt({}));
say("a tail call in it, called by a call", () => { const r = tailInItAgain({}); return r; });
say("a call in it, called by a call", () => { const r = callInItAgain({}); return r; });
say("new in it", () => { const r = newInIt({}); return r; });
say("a call in a callback", () => nums.map(x => any(x).nothing()));
say("a callback that is nothing much", () => nums.map(x => any(undefined).deeper.still + x));
// Not so little, with several call sites, called by functions that loops call: the inliner treats those call sites like call sites in loops.
function medium(o: any, k: number) { if (o === null) throw new TypeError("null at " + k); const t = o.type === "a" || o.type === "b"; return t && o.n > k ? o.n - k : -1; }
function mediumDefault(o: any, k = 2, extra?: any) { return (o.n ?? 0) * k + (extra === undefined ? 0 : 1); }
function calledInLoop(o: any) { return medium(o, 1) + mediumDefault(o); }
function oneDown(o: any) { return calledInLoop(o) + medium(o, 2); }
function twoDown(o: any) { return oneDown(o) + mediumDefault(o, 3, 0); }
function threeDown(o: any) { return twoDown(o) + medium(o, 3); }
const things: any[] = [{ type: "a", n: 5 }, { type: "b", n: 1 }, { type: "c", n: 9 }, { n: 2 }, { type: "a" }];
say("called in a loop", () => { let t = 0; for (const o of things) t += calledInLoop(o); return t; });
say("one, two and three down", () => { const r: number[] = []; for (const o of things) r.push(oneDown(o), twoDown(o), threeDown(o)); return r; });
say("as callbacks", () => [things.map(calledInLoop), things.filter(o => oneDown(o) > 0).length, things.some(twoDown), things.findIndex(o => threeDown(o) < 0), things.reduce((n, o) => n + calledInLoop(o), 0)]);
say("outside any loop too", () => [calledInLoop(things[0]), threeDown(things[1]), medium(things[2], 0), mediumDefault(things[3])]);
say("throws two down", () => { try { for (const o of [things[0], null]) twoDown(o); } catch (e) { return where(e); } });
say("throws in a callback", () => { try { return [things[0], null].map(oneDown); } catch (e) { return where(e); } });
say("throws three down, outside any loop", () => { try { return threeDown(null); } catch (e) { return where(e); } });
let hook = (o: any) => medium(o, 0); function throughHook(o: any) { return hook(o) + 1; }
say("through a variable that changes", () => { const r = things.map(throughHook); hook = o => mediumDefault(o, 10); return [r, things.map(throughHook)]; });
function pingHot(n: number, o: any): number { return n <= 0 ? medium(o, 0) : pongHot(n - 1, o) + 1; }
function pongHot(n: number, o: any): number { return n <= 0 ? mediumDefault(o) : pingHot(n - 1, o) + 1; }
say("mutual recursion from a loop", () => { let t = 0; for (let i = 0; i < 6; i++) t += pingHot(i, things[0]); return t; });
let tally = 0; function tallies(o: any) { tally += o.n ?? 0; const before = tally; tally += medium(o, 0) > 0 ? 1 : 0; return before; }
function talliesTwice(o: any) { return tallies(o) + tallies(o); }
say("module variables, in order", () => [things.map(talliesTwice), tally]);
say("another module's, from a callback", () => [things.map(o => fromOther(o.n ?? 0, 1)), things.map(() => bumps()).length, counter]);
say("another module's throws, from a callback", () => { try { return things.map(o => (o.n === 9 ? throwsInOther("nine") : 0)); } catch (e) { return where(e); } });
