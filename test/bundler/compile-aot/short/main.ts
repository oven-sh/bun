import anonymousDefault, { arrowInOther, importsLater, inOther, stackHere, whoImports } from "./other";
import { inspect } from "node:util";
const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
// Features that depend on the program's source text, which is not present in every build configuration that this is compared across.
const sayOfText = (name: string, f: () => unknown) => say("text: " + name, f);

// ---- every kind of function
function declared(a: any, b: any, c: any) { return a; }
function noParameters() {}
function withDefaults(a: any, b = 1, c?: any) {}
function withRest(a: any, ...rest: any[]) {}
function destructures({ a, b }: any, [c]: any) {}
const arrow = (a: any) => a;
const arrowNone = () => {};
const asyncArrow = async (a: any, b: any) => a;
const expression = function (a: any) {};
const namedExpression = function inner(a: any, b: any) { return typeof inner; };
async function asyncDeclared(a: any) { await null; return a; }
function* generator(a: any, b: any) { yield a; }
async function* asyncGenerator(a: any) { yield a; }
const sym = Symbol("described");
const symNone = Symbol();
const key = "comp" + "uted";
const object = {
  method(a: any) { return a; },
  async asyncMethod() {},
  *generatorMethod() {},
  async *asyncGeneratorMethod() {},
  get accessor() { return 1; },
  set accessor(v: any) {},
  [key](a: any, b: any) {},
  [sym]() {},
  [symNone]() {},
  property: function () {},
  arrowProperty: () => {},
  "quoted name"() {},
  123() {},
};
class Plain { constructor(a: any, b: any) {} method() {} static staticMethod(a: any) {} get g() { return 1; } set g(v) {} }
class NoConstructor {}
class Derived extends Plain { constructor() { super(1, 2); } over() { return super.method; } }
class DerivedNoConstructor extends Plain {}
class WithFields { x = 1; static s = 2; #p = 3; m() { return this.#p; } static { WithFields.s++; } arrowField = () => this.x; }
const classExpression = class {};
const namedClassExpression = class Inner { static who() { return Inner.name; } };
const bound = declared.bind(null, 1);
const boundTwice = bound.bind(null);
const nested = (() => function deep(a: any) { return () => function deeper() {}; })();

const all: Record<string, Function> = {
  declared, noParameters, withDefaults, withRest, destructures, arrow, arrowNone, asyncArrow, expression, namedExpression, asyncDeclared, generator,
  asyncGenerator, method: object.method, asyncMethod: object.asyncMethod, generatorMethod: object.generatorMethod,
  asyncGeneratorMethod: object.asyncGeneratorMethod, getter: Object.getOwnPropertyDescriptor(object, "accessor")!.get!,
  setter: Object.getOwnPropertyDescriptor(object, "accessor")!.set!, computed: (object as any)[key], symbolNamed: (object as any)[sym],
  symbolNoDescription: (object as any)[symNone], property: object.property, arrowProperty: object.arrowProperty, quoted: (object as any)["quoted name"],
  numeric: (object as any)[123], Plain, plainMethod: Plain.prototype.method, staticMethod: Plain.staticMethod,
  classGetter: Object.getOwnPropertyDescriptor(Plain.prototype, "g")!.get!, NoConstructor, Derived, over: Derived.prototype.over, DerivedNoConstructor, WithFields,
  fieldMethod: WithFields.prototype.m, arrowField: new WithFields().arrowField, classExpression, namedClassExpression, bound, boundTwice, nested,
  nested2: nested(1), nested3: nested(1)(), inOther, arrowInOther, anonymousDefault, whoImports,
};
for (const [label, f] of Object.entries(all)) {
  say(label, () => [
    JSON.stringify(f.name), f.length, typeof f, Object.prototype.toString.call(f), Object.getOwnPropertyNames(f).sort().join(),
    "prototype" in f ? typeof (f as any).prototype : "-", Object.getPrototypeOf(f) === Function.prototype ? "F" : Object.getPrototypeOf(f)?.constructor?.name ?? Object.getPrototypeOf(f)?.name,
    JSON.stringify(Object.getOwnPropertyDescriptor(f, "name")), JSON.stringify(Object.getOwnPropertyDescriptor(f, "length")),
    JSON.stringify(Object.getOwnPropertyDescriptor(f, "prototype") && { ...Object.getOwnPropertyDescriptor(f, "prototype"), value: 0 }),
  ].join(" "));
  say(label + " called", () => { const r = (f as any)(); return typeof r + ":" + Object.prototype.toString.call(r); });
  say(label + " constructed", () => { const r = new (f as any)(); return typeof r + ":" + (Object.getPrototypeOf(r) === (f as any).prototype); });
  say(label + " Reflect.construct", () => Object.getPrototypeOf(Reflect.construct(Object, [], f)) === (f as any).prototype);
  say(label + " caller", () => (f as any).caller);
  say(label + " arguments", () => (f as any).arguments);
  say(label + " hasOwn", () => ["caller", "arguments", "name", "length", "prototype"].map(k => +Object.hasOwn(f, k)).join(""));
  say(label + " inspect", () => inspect(f) + " / " + Bun.inspect(f));
  sayOfText(label, () => JSON.stringify(String(f)) + (String(f) === Function.prototype.toString.call(f) ? "" : " NOT THE SAME TWICE"));
  sayOfText(label + " starts", () => String(f).replace(/\s+/g, " ").slice(0, 5).replace(/[^a-z*( ]/g, "?"));
}

// ---- names and lengths that are changed, or deleted
say("delete name", () => { function f(a: any) {} delete (f as any).name; return JSON.stringify(f.name) + Object.hasOwn(f, "name"); });
say("delete length", () => { function f(a: any) {} delete (f as any).length; return f.length + "" + Object.hasOwn(f, "length"); });
say("define name", () => { function f() {} Object.defineProperty(f, "name", { value: "other" }); return f.name + "/" + f.bind(null).name; });
say("define length", () => { function f(a: any, b: any) {} Object.defineProperty(f, "length", { value: 7 }); return f.length + "/" + f.bind(null, 1).length; });
say("assign name", () => { function f() {} (f as any).name = "no"; return f.name; });
say("prototype", () => { function f() {} const p = f.prototype; return (p.constructor === f) + "," + (f.prototype === p) + "," + Object.getOwnPropertyNames(p); });
say("generator prototype", () => Object.getPrototypeOf(generator.prototype) === Object.getPrototypeOf(function* () {}).prototype);
say("many of one", () => { const fs = [1, 2, 3].map(i => function same(a: any) { return i; }); return fs.map(f => f.name + f.length + f(0)).join() + (fs[0] === fs[1]) + (fs[0].prototype === fs[1].prototype); });
say("instanceof", () => [new Plain(1, 2) instanceof Plain, new Derived() instanceof Plain, new (declared as any)() instanceof declared, {} instanceof (bound as any)].join());
say("new.target", () => { function f(this: any) { return new.target === undefined ? "call" : new.target.name; } return f() + "," + String(new (f as any)() instanceof f) + "," + Reflect.construct(function () { return { t: new.target!.name }; }, [], Plain).t; });
say("fields", () => { const w = new WithFields(); return [w.x, WithFields.s, w.m(), w.arrowField()].join(); });
say("super", () => new Derived().over() === Plain.prototype.method);
say("named class", () => namedClassExpression.who());
say("named expression", () => namedExpression(1, 2));

// ---- stacks
function outer() { return middle(); }
function middle() { const r = innermost(); return r; }
function innermost() { return new Error("x").stack!.split("\n").slice(0, 4).map(l => l.trim().replace(/\(?[^ (]*[\\/]/, "(")).join(" | "); }
say("stack", () => { const r = outer(); return r; });
say("stack of another module", () => stackHere().split("\n").slice(0, 2).map(l => l.trim().replace(/\(?[^ (]*[\\/]/, "(")).join(" | "));
say("stack through a method", () => { const o = { m() { return new Error("m").stack!.split("\n")[1].trim().replace(/\(?[^ (]*[\\/]/, "("); } }; const r = o.m(); return r; });
say("stack through a constructor", () => { class C { s: string; constructor() { this.s = new Error("c").stack!.split("\n")[1].trim().replace(/\(?[^ (]*[\\/]/, "("); } } return new C().s; });
say("stack through a getter", () => { const o = { get g() { return new Error("g").stack!.split("\n")[1].trim().replace(/\(?[^ (]*[\\/]/, "("); } }; const r = o.g; return r; });
say("call sites", () => {
  const previous = (Error as any).prepareStackTrace;
  (Error as any).prepareStackTrace = (_: any, sites: any[]) => sites.slice(0, 3).map(s => [
    s.getFunctionName(), s.getMethodName(), s.getTypeName(), typeof s.getFunction(), s.getFunction()?.name, s.getLineNumber() > 0, s.getColumnNumber() > 0,
    String(s.getFileName()).split(/[\\/]/).pop(), s.isNative(), s.isConstructor(), s.isToplevel(), s.isEval(), s.isAsync(), s.isPromiseAll(),
  ].join(":")).join(" | ");
  try { function a() { const r = new (B as any)(); return r.s; } function B(this: any) { this.s = c(); } function c() { return new Error("s").stack; } const r = a(); return r; }
  finally { (Error as any).prepareStackTrace = previous; }
});
say("captureStackTrace", () => { function skip() { const o: any = {}; Error.captureStackTrace(o, skip); return o.stack.split("\n")[1].trim().replace(/\(?[^ (]*[\\/]/, "("); } function from() { const r = skip(); return r; } const r = from(); return r; });

// ---- features that depend on the function's source file
say("import.meta", () => whoImports());
say("import.meta here", () => (() => import.meta.url.split("/").pop())());
out.push("import() = " + await importsLater());
out.push("import() here = " + await (async function () { return (await import("./third")).third(); })());
say("require.resolve", () => { function f() { return typeof import.meta.resolve("./third"); } return f(); });

// ---- eval, new Function, templates
say("direct eval", () => { function f(a: number) { const local = a * 2; return eval("local + a"); } return f(4); });
say("direct eval, this and arguments", () => { function f(this: any, a: number) { return eval("this.k + arguments.length + a"); } return f.call({ k: 1 }, 2); });
say("direct eval in an arrow in a method", () => { const o = { k: 5, m() { return (() => eval("this.k"))(); } }; return o.m(); });
say("direct eval, new.target", () => { function f() { return eval("typeof new.target"); } return f() + new (function (this: any) { this.t = eval("typeof new.target"); } as any)().t; });
say("direct eval, super", () => { class A { v() { return 1; } } class B extends A { v() { return eval("super.v()") + 1; } } return new B().v(); });
say("direct eval, before it is initialized", () => { function f() { const r = eval("typeof later; later"); const later = 1; return r; } return f(); });
say("direct eval declares", () => { function f() { eval("var made = 3"); return typeof (globalThis as any).made; } return f(); });
say("function in eval", () => { function f() { return eval("(function inEval(a, b) { return inEval.name + inEval.length })")(); } return f(); });
say("new Function", () => { const f = new Function("a", "b", "return a + b"); return f.name + f.length + f(1, 2); });
function tag(strings: TemplateStringsArray, ...values: any[]) { return strings; }
function tagged(i: number) { return tag`a${i}b`; }
say("templates", () => [tagged(1) === tagged(2), tagged(1).raw.join(), Object.isFrozen(tagged(1)), (() => tag`a${0}b`)() === tagged(1)].join());

// ---- tools
say("heap snapshot", () => { const s: any = Bun.generateHeapSnapshot(); return typeof s + Array.isArray(s.nodes); });
say("v8 heap snapshot", () => typeof Bun.generateHeapSnapshot("v8"));
{
  const jsc = await import("bun:jsc");
  say("describe", () => typeof jsc.describe(declared));
  say("heapStats", () => jsc.heapStats().objectTypeCounts.FunctionExecutable >= 0);
  function busy() { let s = 0; for (let i = 0; i < 3e6; i++) s += hot(i); return s; }
  function hot(i: number) { return Math.sqrt(i) | 0; }
  // (Whether a sample lands in the loop is a matter of luck: on a busy machine with the collector running constantly, none may. The test is whether the profiler can name these functions.)
  say("profile", () => { let p: any, named = false; for (let i = 0; i < 40 && !named; i++) { p = jsc.profile(busy, 100); named = /busy|hot/.test(p.functions + JSON.stringify(p.stackTraces)); } return typeof p.functions + typeof p.bytecodes + typeof p.stackTraces + named; });
  say("debugging snapshot", () => typeof (jsc as any).generateHeapSnapshotForDebugging());
}
{
  const inspector = await import("node:inspector");
  await new Promise<void>(resolve => {
    try {
      const session = new inspector.Session();
      session.connect();
      session.post("Profiler.enable", () => session.post("Profiler.start", () => {
        let s = 0; for (let i = 0; i < 2e6; i++) s += declared(i, 0, 0);
        session.post("Profiler.stop", (error: any, result: any) => {
          out.push("inspector profile = " + (error ? "error" : typeof result?.profile?.nodes?.length));
          session.disconnect(); resolve();
        });
      }));
    } catch (e: any) { out.push("inspector profile = threw " + e?.name); resolve(); }
  });
}
say("structuredClone", () => structuredClone(declared as any));
say("JSON", () => JSON.stringify({ declared, a: [arrow] }));
say("console.log", () => { console.log(declared, arrow, Plain, object.method, asyncDeclared, generator, bound); return "ok"; });
Bun.gc(true);
say("after gc", () => Object.values(all).map(f => f.name.length + f.length).join(""));

// ---- another thread
out.push("worker = " + await new Promise<string>((resolve, reject) => {
  const w = new Worker(new URL("./worker.ts", import.meta.url).href);
  w.onmessage = e => { resolve(e.data); w.terminate(); };
  w.onerror = e => { resolve("error " + e.message); };
  w.postMessage("hi");
}));
console.log(out.join("\n"));
