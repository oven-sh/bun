const out = [];
const t = (name, f) => { try { out.push(name + " " + String(f())); } catch (e) { out.push(name + " threw " + e.name + ": " + e.message); } };
function closure(a) { let b = a * 2; const c = "c"; return eval("a + b + c"); }
t("closure", () => closure(1));
function declares() { eval("var v = 5; function g() { return v + 1 }"); return v + g(); }
t("declares", declares);
function strict() { "use strict"; eval("var hidden = 1"); return typeof hidden; }
t("strict", strict);
function tdz() { const r = eval("typeof late === 'undefined' ? 'u' : late"); let late = 1; return r; }
t("tdz", tdz);
function assigns() { let x = 1; eval("x = x + 41"); return x; }
t("assigns", assigns);
function constAssign() { const k = 1; eval("k = 2"); return k; }
t("constAssign", constAssign);
function thisAndArgs() { return eval("[this.tag, arguments.length, arguments[1]].join()"); }
t("thisAndArgs", () => thisAndArgs.call({ tag: "T" }, 1, 2, 3));
function NewTarget() { this.nt = eval("new.target === NewTarget"); }
t("newTarget", () => new NewTarget().nt);
const arrow = { tag: "A", m() { return (() => eval("this.tag + arguments[0]"))(); } };
t("arrow", () => arrow.m("z"));
class Base { hi() { return "base"; } }
class Derived extends Base { #p = 7; static s = eval("1 + 1"); f = eval("this.constructor.name"); hi() { return eval("super.hi() + this.#p"); } has(o) { return eval("#p in o"); } }
t("class", () => { const d = new Derived(); return [d.hi(), d.f, Derived.s, d.has(d), d.has({})].join(); });
class Ctor extends Base { constructor() { eval("super()"); this.ok = eval("this instanceof Ctor"); } }
t("superCall", () => new Ctor().ok);
function nested(n) { return eval("(function inner(m) { return eval('n + m') })")(n + 1); }
t("nested", () => nested(10));
function* gen(a) { yield eval("a"); a++; yield eval("a * 2"); }
t("generator", () => [...gen(3)].join());
async function asy(a) { await null; return eval("a + 1"); }
function loop() { let s = 0; for (let i = 0; i < 300; i++) s += eval("i % 7"); return s; }
t("loop", loop);
function syntax() { return eval("1 +"); }
t("syntax", syntax);
function throwsInside() { return eval("null.x"); }
t("throwsInside", throwsInside);
function stack() { try { eval("(void 0)()"); } catch (e) { return String(e.stack).split("\n").slice(0, 4).map(l => l.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ")).join(" < "); } }
t("stack", stack);
function indirect() { const local = 1; return (0, eval)("typeof local"); }
t("indirect", indirect);
function withCatch() { try { throw 5; } catch (e) { return eval("e * 2"); } finally { eval("0"); } }
t("withCatch", withCatch);
function sloppyCaller() { return callee(); } function callee() { return callee.caller === sloppyCaller ? "caller ok" : String(callee.caller); }
t("caller", sloppyCaller);
function fnArguments(a, b) { return inner(); function inner() { return Array.from(fnArguments.arguments).join(); } }
t("fn.arguments", () => fnArguments(4, 5, 6));
function destructure({ a, ...rest }, [x, ...ys]) { return eval("a + JSON.stringify(rest) + x + ys.length"); }
t("destructure", () => destructure({ a: 1, b: 2, c: 3 }, [7, 8, 9]));
function tagged() { const tag = (s, ...v) => s.raw.join("|") + v.join(); return eval("tag`x${1}y${2}z`") + tag`p${3}q`; }
t("tagged", tagged);
function big() { let r = 0; switch (eval("'beta'")) { case "alpha": r = 1; break; case "beta": r = 2; break; case "gamma": r = 3; break; default: r = 9; } return r; }
t("switch", big);
t("Function", () => new Function("a", "b", "return a * b")(6, 7));
const prepare = Error.prepareStackTrace; Error.prepareStackTrace = (e, sites) => sites.slice(0, 3).map(s => [s.getFunctionName(), s.getLineNumber() > 0, s.isEval(), s.isNative(), s.isToplevel(), s.isConstructor(), typeof s.getFileName()].join(":")).join(" | ");
function sites() { return new Error("x").stack; } function Ctor2() { this.s = sites(); }
t("callsites", () => new Ctor2().s); Error.prepareStackTrace = prepare;
Error.prepareStackTrace = (e, sites) => sites.slice(0, 4).map(s => s.getFunctionName() + "@" + s.getLineNumber() + ":" + s.getColumnNumber()).join(" | ");
class Thrower { constructor(deep) { if (deep) return new Thrower(deep - 1); this.s = new Error("y").stack; } }
function makes() { const pad = 1; return   new Thrower(1).s; } function spread(...a) { return new   Thrower(...a).s; }
class Sub extends Thrower { constructor() { super(0); } }
t("newpositions", () => makes()); t("newspread", () => spread(0)); t("newsuper", () => new Sub().s);
t("newmultiline", () => new
  Thrower(
    0).s); Error.prepareStackTrace = prepare;
out.push("async " + await asy(1));
console.log(out.join("\n"));
