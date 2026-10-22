// One call site in evaluated text calls compiled functions: one callee, a few, many, and values that cannot be called.
class Shape { constructor(public side = 2) {} area() { return this.side * this.side; } static of(side: number) { return new Shape(side); } get twice() { return this.side * 2; } }
class Cube extends Shape { area() { return 6 * super.area(); } }
function plain(a: any, b: any) { return a + b; }
function sloppyThis(this: unknown) { return typeof this; }
function counts(...rest: unknown[]) { return rest.length; }
function defaults(a = 1, b = 2, c = 3) { return a * 100 + b * 10 + c; }
function usesArguments() { return arguments.length; }
function usesNewTarget(this: unknown) { return new.target === undefined ? "call" : "construct"; }
function Legacy(this: { v: number }, v: number) { this.v = v; }
Legacy.prototype.get = function (this: { v: number }) { return this.v; };
const arrow = (a: any) => a + 1;
const bound = plain.bind(null, 10);
const boundMethod = Shape.prototype.area.bind(new Shape(3));
async function later(a: number) { return a; }
function* many(a: number) { yield a; yield a + 1; }
function thrower(): never { throw new RangeError("from compiled code"); }
function hide(value: unknown): any { return value; }
let line = 0;
function show(title: string, ...values: unknown[]) { console.log(String(++line).padStart(2, "0"), title + ":", values.map(v => typeof v === "string" ? v : JSON.stringify(v) ?? String(v)).join(" | ")); }
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return "THROWN " + (e as Error).name + ": " + (e as Error).message; } };
const make = (parameters: string, body: string) => new Function(...parameters.split(","), body) as (...a: any[]) => any;

const callTwo = make("f,a,b", "let r; for (let i = 0; i < 6; i++) r = f(a, b); return r;");
const callNone = make("f", "let r; for (let i = 0; i < 6; i++) r = f(); return r;");
const callSeven = make("f", "let r; for (let i = 0; i < 6; i++) r = f(1, 2, 3, 4, 5, 6, 7); return r;");
const callMethod = make("o", "let r; for (let i = 0; i < 6; i++) r = o.area(); return r;");
const construct = make("F,a", "let r; for (let i = 0; i < 6; i++) r = new F(a); return r;");
const callEach = make("list,a,b", "const out = []; for (let round = 0; round < 3; round++) for (let i = 0; i < list.length; i++) out.push(list[i](a, b)); return out;");
const strictCall = make("f", '"use strict"; let r; for (let i = 0; i < 6; i++) r = f(); return r;');

show("one callee", callTwo(plain, 1, 2), callTwo(plain, 1.5, 2), callTwo(plain, "a", "b"));
show("numbers of arguments", callNone(counts), callSeven(counts), callNone(defaults), callSeven(defaults), callNone(usesArguments), callSeven(usesArguments), String(callNone(plain)), callSeven(plain));
show("this", callNone(sloppyThis), strictCall(sloppyThis), callNone(usesNewTarget), callNone(hide(() => typeof hide(globalThis))));
show("kinds of function", callTwo(arrow, 1, 2), callTwo(bound, 1, 2), callNone(boundMethod), typeof callTwo(later, 1, 2).then, [...callTwo(many, 1, 2)], callTwo(Shape.of, 4, 0).area());
show("a few callees in turn", callEach([plain, arrow, bound], 1, 2));
show("compiled functions, functions of the text, native functions", callEach([plain, make("a,b", "return a * b"), Math.max, arrow, make("a", "return -a"), Math.min, String], 3, 4));
const twenty: ((a: number, b: number) => number)[] = []; for (let i = 0; i < 20; i++) twenty.push((a, b) => a + b + i);
show("twenty closures of one function", callEach(twenty, 1, 2).slice(0, 22));
const different = [plain, arrow, bound, counts, defaults, (a: number) => a * 2, (a: number) => a * 3, (a: number) => a * 4, (a: number) => a * 5, (a: number) => a * 6, (a: number) => a * 7, (a: number) => a * 8, (a: number) => a * 9, (a: number) => a - 1, (a: number) => a - 2, (a: number) => a - 3, (a: number) => a - 4, (a: number) => a - 5];
show("eighteen functions", callEach(different, 1, 2).slice(0, 20));
show("methods", callMethod(new Shape()), callMethod(new Cube()), callMethod(new Shape(5)), callMethod({ area: () => "own" }), callMethod({ area: plain }) !== callMethod({ area: plain }), callMethod(Object.create(new Cube(1))));
show("a method is replaced between calls", (() => { const s = new Shape(2); const before = callMethod(s); const original = Shape.prototype.area; Shape.prototype.area = function () { return -1; }; const during = callMethod(s); Shape.prototype.area = original; return [before, during, callMethod(s)]; })());
show("construct", construct(Shape, 3).area(), construct(Cube, 1).area(), construct(Legacy, 4).get(), construct(Shape, 3) instanceof Shape, construct(Cube, 1) instanceof Shape, construct(usesNewTarget, 0) instanceof usesNewTarget, construct(hide(bound), 1) instanceof plain);
show("several constructors in turn", [Shape, Cube, Legacy, Shape, make("a", "this.a = a"), Map, Cube].map(F => Object.getPrototypeOf(construct(F, undefined)) === F.prototype));
show("what cannot be called", ...[undefined, null, 1, "s", {}, new Shape(), Shape, Cube].map(f => attempt(() => callTwo(f, 1, 2))));
show("what cannot be constructed", ...[undefined, 1, {}, arrow, later, many, Shape.prototype.area, Math.max].map(F => attempt(() => construct(F, 1))));
show("a callee, then no callee, then the callee", callTwo(plain, 1, 2), attempt(() => callTwo(undefined, 1, 2)), callTwo(plain, 3, 4));
show("exceptions", attempt(() => callNone(thrower)), make("f", "try { f(); } catch (e) { return 'caught in text: ' + e.message; }")(thrower), attempt(() => make("f", "try { f(); } finally { f = 1; }")(thrower)));
const pingPong = make("f,n", "return n ? f(n - 1) + 1 : 0;");
function back(n: number): number { return pingPong(back, n); }
show("text and compiled code call each other", back(200));
show("too deep", attempt(() => back(1e7)) === attempt(() => back(1e7)));
show("call, apply, Reflect", make("f", "return [f.call(null, 1, 2), f.apply(null, [3, 4]), Reflect.apply(f, null, [5, 6]), Reflect.construct(Object, [], f) instanceof f]")(plain));
show("spread and rest", make("f,list", "return [f(...list), f(0, ...list), f(...list, ...list)]")(counts, [1, 2, 3]));
show("tail position", make("f,a,b", '"use strict"; return f(a, b);')(plain, 1, 2), make("o", '"use strict"; return o.area();')(new Cube(2)));
show("getters and callbacks", make("o", "let r = 0; for (let i = 0; i < 6; i++) r += o.twice; return r;")(new Shape(2)), make("list,f", "return list.map(f)")([1, 2, 3], arrow), [1, 2, 3].map(make("a", "return a * 2")));
{
  // The callee of a site dies, and the site is used again.
  const site = make("f,a", "return f(a);");
  let total = 0;
  for (let round = 0; round < 30; round++) { const callee = hide((a: number) => a + round); for (let i = 0; i < 4; i++) total += site(callee, i); if (round % 5 === 0) Bun.gc(true); }
  show("callees that die", total);
}
