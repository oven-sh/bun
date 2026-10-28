// Functions are assigned again, names without a declaration land on the global object, and a function reaches itself without naming its variable.
const out = [];
function f1() { return 1; } const c1 = () => f1(); f1 = () => 2; out.push(c1());
out.push((function me() { me = 5; return typeof me; })());
counter = 0; function inc() { counter++; } inc(); inc(); out.push(counter, globalThis.counter);
globalThis.gv = 1; function readGv() { return gv; } out.push(readGv()); globalThis.gv = 2; out.push(readGv()); gv = 3; out.push(globalThis.gv, readGv());
let n = 0; Object.defineProperty(globalThis, "acc", { get() { return ++n; }, configurable: true }); function readAcc() { return acc; } out.push(readAcc(), readAcc());
function thisGlobal() { this.viaThis = 4; } thisGlobal(); out.push(viaThis);
delete globalThis.gv; out.push(typeof gv); try { readGv(); } catch (e) { out.push(e.name); }
(0, eval)("var ev = 5"); function readEv() { return ev; } out.push(readEv()); (0, eval)("ev = 6"); out.push(readEv());
new Function("fromFn = 7")(); out.push(fromFn);
out.push(typeof undefinedThing);
var undefined_ = undefined; out.push(undefined_);
function args() { return arguments.callee === args; } out.push(args());
function onlyCalled() { return arguments.callee.tag; } onlyCalled.tag = 8; out.push(onlyCalled());
function Ctor() {} out.push(new Ctor().constructor === Ctor, new Ctor().constructor.name);
function nt() { return new.target === nt; } out.push(new nt() instanceof nt, Reflect.construct(nt, []) instanceof nt);
var v1 = 1; var v1; out.push(v1); var v2 = 1; { var v2 = 2; } out.push(v2);
function hoist() { x = 5; const g = () => x; var x; return g(); } out.push(hoist());
function paramFn(a) { function a() {} return typeof a; } out.push(paramFn(1));
function paramVar(a) { var a; return a; } out.push(paramVar(1));
function argsShadow(arguments) { return arguments; } out.push(argsShadow(9));
function argsVar() { var arguments = 10; return arguments; } out.push(argsVar());
function argsClosure(a) { const g = () => arguments[0]; a = 12; return g(); } out.push(argsClosure(1));
console.log(JSON.stringify(out));
