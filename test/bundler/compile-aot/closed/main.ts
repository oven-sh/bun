import theDefault, { onlyImported, importedAndPassedAString, table, arrow } from "./lib";
import * as ns from "./lib";
import { viaNamedReexport, notReexported, renamedOnTheWay } from "./pure2";
import { viaStarReexport, twoStarsAway } from "./pure3";
import { insideANamespace } from "./pure4";
import { notSeenByEval } from "./pure7";
import { askedForByName, askedForByNameToo, notAskedFor } from "./pure6";
import { numbersFromBoth, aStringFromTheOther, aStringFromHere, intsHereDoublesThere, anArrowOfBoth } from "./pure";
import * as viaStar from "./star";
const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
const show = (x: unknown) => typeof x + ":" + String(x);
const S: any = "s";
const opaque = <T,>(x: T): T => (globalThis as any).nothingHere ? (undefined as any) : x;

function inALoop() { let sum = 0; for (let i = 0; i < 20; i++) sum += givenLater(i); return sum; }
say("before it is initialized", () => inALoop());
const givenLater = function (a: number) { return a | 0; };
say("after it is initialized", () => inALoop());

function replaced(_class: unknown, _context: unknown) { return class { who() { return "the other"; } } as any; }
@replaced class Decorated { who() { return "the one that was declared"; } }
say("decorated", () => new Decorated().who());

function calledFromALoopOnly(s: string) { if (!s.startsWith("a")) return; const rest = s.slice(1); return rest.length ? rest : undefined; }
function loops() {
  const list = ["ab", "c", "ad"];
  for (const each of [...list]) { const more = calledFromALoopOnly(each); if (more !== undefined) list.push(more); holdOn(() => each); }
  for (const [key, value] of Object.entries({ k: "ae" })) { try { const more = calledFromALoopOnly(value); if (more) list.push(key + more); holdOn(() => key); } finally { list.push("."); } }
  return list;
}
const kept: unknown[] = [];
function holdOn(f: unknown) { kept.push(f); }
say("called from a loop only", () => loops().join());

const groups = { all: [{ name: "abc:g", map: { a: "abc:h", b: "", c: 3, d: "abc:i,abc:j" } as Record<string, unknown> }] };
function splitAfterLoops(s: string) { return s.split(","); }
function calledAfterLoops(s: string) { if (!s.startsWith("abc:")) return; const rest = s.slice(4); return /^[a-z]+$/.test(rest) ? rest : undefined; }
function loopsAndThenACall() {
  const list = ["abc:x", "nope"];
  for (const g of groups.all) {
    list.push(g.name);
    for (const [k, v] of Object.entries(g.map)) {
      if (typeof v !== "string" || v === "") continue;
      if (k === "d") list.push(...splitAfterLoops(v));
      else list.push(v);
    }
  }
  for (const x of [...list]) { const y = calledAfterLoops(x); if (y !== undefined) list.push(y); }
  return list;
}
say("called after loops", () => loopsAndThenACall().join());

function afterAnAwait(s: string) { return s.length > 1 ? s.slice(1) : undefined; }
function afterAYield(s: string) { return s.length > 1 ? s.slice(1) : undefined; }
function inACatchAfterAnAwait(s: string) { return s.length > 1 ? s.slice(1) : undefined; }
async function awaitsAndCalls() { const a = await Promise.resolve("ab"); const b = afterAnAwait(a); await 0; return b + "/" + afterAnAwait("cd"); }
function* yieldsAndCalls() { const a: string = yield "first"; yield afterAYield(a); yield afterAYield("ef"); }
async function catchesAndCalls() { try { await Promise.reject(new Error("no")); } catch { return inACatchAfterAnAwait("gh"); } finally { await 0; } }
out.push("after an await = " + String(await awaitsAndCalls()));
say("after a yield", () => { const g = yieldsAndCalls(); g.next(); return String(g.next("xy").value) + String(g.next().value); });
out.push("in a catch, after an await = " + String(await catchesAndCalls()));

function numbersOnly(x: number) { return show(x); }
say("numbers only", () => numbersOnly(1) + numbersOnly(2.5) + numbersOnly(-0) + numbersOnly(NaN));
function intsOnly(x: number) { return show(x / 2) + show(x | 0) + show(x + 0.5); }
say("ints only", () => intsOnly(1) + intsOnly(7) + intsOnly(-2147483648) + intsOnly(2147483647));
function passedAString(x: number) { return show(x); }
say("a number", () => passedAString(1));
say("a string", () => passedAString(S));
function tooFew(x: number) { return show(x); }
say("too few", () => (tooFew as any)());
function optional(x: number, y?: string) { return show(x) + show(y); }
say("optional", () => optional(1) + optional(2, "b") + optional(3, undefined));
say("optional, wrong", () => optional(1, 5 as any));
function tooMany(x: number) { return show(x) + arguments.length; }
say("too many", () => (tooMany as any)(1, S, S));
function nullable(x: number | null) { return show(x); }
say("nullable", () => nullable(1) + nullable(null));
say("nullable, undefined", () => nullable(undefined as any));

function identity(x: any) { return x; }
function fromAResult(x: number) { return show(x); }
say("from a result", () => fromAResult(identity(1)));
say("from a result, a string", () => fromAResult(identity(S)));
let moduleVariable: any = 1;
function fromAVariable(x: number) { return show(x); }
say("from a variable", () => fromAVariable(moduleVariable));
moduleVariable = "changed";
say("from a variable, changed", () => fromAVariable(moduleVariable));
function first(x: any) { return second(x); }
function second(x: any) { return third(x); }
function third(x: number) { return show(x); }
say("three deep", () => first(1));
say("three deep, a string", () => first(S));
function recursive(x: number, depth: number): string { return depth ? (recursive as any)(depth === 1 ? S : x, depth - 1) : show(x); }
say("recursive", () => recursive(1, 0));
say("recursive, a string at the end", () => recursive(1, 3));
function ping(x: number, n: number): string { return n ? pong(n === 1 ? S : x, n - 1) : show(x); }
function pong(x: number, n: number): string { return n ? ping(x, n - 1) : show(x); }
say("one another", () => ping(1, 4));
say("one another, a string", () => ping(1, 3));

function stored(x: number) { return show(x); }
const keptIn: any = stored;
say("stored", () => stored(1) + keptIn(S));
function asCallback(x: number) { return show(x); }
say("as a callback", () => asCallback(1) + [S].map(asCallback as any));
function byCall(x: number) { return show(x); }
say("call", () => byCall(1) + byCall.call(null, S));
function byApply(x: number) { return show(x); }
say("apply", () => byApply(1) + byApply.apply(null, [S] as any));
function byBind(x: number) { return show(x); }
say("bind", () => byBind(1) + byBind.bind(null, S)());
function byReflect(x: number) { return show(x); }
say("Reflect.apply", () => byReflect(1) + Reflect.apply(byReflect, null, [S]));
function inALiteral(x: number) { return show(x); }
say("in a literal", () => inALiteral(1) + ({ inALiteral } as any).inALiteral(S));
function inAnArray(x: number) { return show(x); }
say("in an array", () => inAnArray(1) + ([inAnArray] as any)[0](S));
function returned(x: number) { return show(x); }
say("returned", () => returned(1) + (() => returned as any)()(S));
function conditional(x: number) { return show(x); }
function other(x: any) { return "other" + show(x); }
say("one or the other", () => conditional(1) + (opaque(true) ? conditional : other)(S));
function spread(x: number) { return show(x); }
say("spread", () => spread(1) + spread(...([S] as [any])));
function tagged(x: number) { return show(x); }
say("tagged", () => tagged(1) + (tagged as any)`a`);
function maybe(x: number) { return show(x); }
say("optional call", () => maybe(1) + (maybe as any)?.(S));
function constructed(this: any, x: number) { this.x = show(x); }
say("constructed", () => new (constructed as any)(1).x + new (constructed as any)(S).x);
say("by way of what it made", () => new (constructed as any)(1).constructor.call({}, S));
function asDefault(x: number) { return show(x); }
function takesDefault(f: any = asDefault) { return f(S); }
say("a default", () => asDefault(1) + takesDefault());
function inAClass(x: number) { return show(x); }
class Holder { static held: any = inAClass; field: any = inAClass; }
say("in a class", () => inAClass(1) + Holder.held(S));
function behindAGetter(x: number) { return show(x); }
const withGetter: any = Object.defineProperty({}, "f", { get: () => behindAGetter });
say("behind a getter", () => behindAGetter(1) + withGetter.f(S));
function toAFunction(x: number) { return show(x); }
say("new Function", () => toAFunction(1) + new Function("f", "s", "return f(s)")(toAFunction, S));
function thrown(x: number) { return show(x); }
say("thrown", () => { try { throw thrown; } catch (f: any) { return thrown(1) + f(S); } });
function awaited(x: number) { return show(x); }
function yielded(x: number) { return show(x); }
say("yielded", () => yielded(1) + [...(function* () { yield yielded; })()][0](S as never));
function compared(x: number) { return show(x); }
say("compared", () => compared(1) + (opaque<any>(compared) === compared) + typeof compared + compared.name + compared.length);

let alsoHere: any;
const twoVariables = (alsoHere = function (x: number) { return show(x); });
say("two variables", () => twoVariables(1) + alsoHere(S));
const holder: any = {};
const andAProperty = (holder.f = function (x: number) { return show(x); });
say("and a property", () => andAProperty(1) + holder.f(S));
const seen: any[] = [];
const keep = <T,>(f: T): T => (seen.push(f), f);
const wrapped = keep(function (x: number) { return show(x); });
say("wrapped", () => wrapped(1) + seen[0](S));
const anArrow = (x: number) => show(x);
say("an arrow", () => anArrow(1) + anArrow(2));
const anArrowThatGetsAString = (x: number) => show(x);
say("an arrow that gets a string", () => anArrowThatGetsAString(1) + anArrowThatGetsAString(S));
const named = function itself(x: number, again: boolean): string { return again ? (itself as any)(S, false) : show(x); };
say("by its own name", () => named(1, false));
say("by its own name, a string", () => named(1, true));
let reassigned = function (x: number) { return show(x); };
say("before", () => reassigned(1));
reassigned = function (x: any) { return "another" + show(x); };
say("after", () => reassigned(S));

function fromDeadCode(x: number) { return show(x); }
if (opaque(false)) say("never", () => fromDeadCode(S));
say("from dead code", () => fromDeadCode(1));
function neverCalledCaller() { return onlyFromThere(S); }
function onlyFromThere(x: number) { return show(x); }
say("its caller is never called", () => onlyFromThere(1) + typeof neverCalledCaller);
function calledLate(x: number) { return show(x); }
const later: (() => string)[] = [() => calledLate(S)];
say("called late", () => calledLate(1) + later[0]());

async function isAsync(x: number) { return show(x); }
function* isGenerator(x: number) { yield show(x); }
function withHandler(x: number) { try { if (x > 1) throw new Error("big"); return show(x); } catch (e: any) { return e.message + show(x); } finally { out.push("finally " + show(x)); } }
say("with a handler", () => withHandler(1) + withHandler(2));
say("with a handler, a string", () => withHandler(S));
function withRest(x: number, ...rest: string[]) { return show(x) + rest.join(); }
say("with the rest", () => withRest(1) + withRest(2, "a", "b"));
say("with the rest, wrong", () => withRest(S, "a"));
function withArguments(x: number) { return show(arguments[0]) + arguments.length; }
say("with arguments", () => withArguments(1) + (withArguments as any)(2, 3));
function assignsIt(x: number) { const before = show(x); x = x + 1; return before + show(x); }
say("assigns it", () => assignsIt(1) + assignsIt(1.5));
function capturesIt(x: number) { return () => show(x); }
say("captures it", () => capturesIt(1)() + capturesIt(2.5)());
function manyParameters(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) { return [a, b, c, d, e, f, g, h, i, j, k, l, m, n].map(show).join(); }
say("many", () => manyParameters(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14));
say("many, the last is a string", () => manyParameters(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, S));
say("many, the twelfth is a string", () => manyParameters(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, S, 13, 14));

say("only imported", () => onlyImported(1) + onlyImported(2.5));
say("imported", () => importedAndPassedAString(1));
say("imported, a string", () => importedAndPassedAString(S));
say("namespace", () => ns.byNamespace(1) + (ns as any).byNamespace(S));
say("namespace, computed", () => (ns as any)[opaque("byNamespaceComputed")](S));
say("namespace, what is only imported", () => (opaque(ns) as any)[opaque("onlyImported")](S));
say("a value over there", () => table.usedHereAsAValue(S));
say("an arrow over there", () => arrow(1) + arrow(S));
say("the default", () => theDefault(1) + theDefault(S));
say("through a star", () => viaStar.throughStar(1) + (opaque(viaStar) as any).throughStar(S));
say("renamed", () => viaStar.renamed(1) + (opaque(viaStar) as any)[opaque("renamed")](S));

say("async", () => "started");
const results = await Promise.allSettled([isAsync(1), isAsync(S), Promise.resolve(awaited).then(f => awaited(1) + (f as any)(S))]);
for (const r of results) out.push("settled = " + (r.status === "fulfilled" ? r.value : "rejected " + r.reason?.name + ": " + r.reason?.message));
say("generator", () => [...isGenerator(1)].join());
say("generator, a string", () => [...isGenerator(S)].join());
const dyn: any = await import("./dyn");
say("import()", () => dyn.here + dyn.byDynamicImport(1));
say("what they share", () => dyn.shared);
say("by name only", () => dyn.pure);
say("numbers from both", () => numbersFromBoth(1));
say("a string from the other", () => aStringFromTheOther(1));
say("a string from here", () => aStringFromHere(S));
say("ints here", () => intsHereDoublesThere(3));
say("an arrow of both", () => anArrowOfBoth(2));
say("import(), a string", () => dyn.byDynamicImport(S));
say("import(), what is called there with numbers", () => dyn.calledHereWithNumbers(S));
say("with numbers", () => viaNamedReexport(1) + notReexported(2) + renamedOnTheWay(3) + viaStarReexport(4) + twoStarsAway(5) + insideANamespace(6));
const re: any = await import("./reexp");
say("exported again by name", () => re.viaNamedReexport(S));
say("exported again under another name", () => re.underAnotherName(S));
say("exported again with a star", () => re.viaStarReexport(S));
say("two stars away", () => re.twoStarsAway(S));
say("inside a namespace", () => re.everything.insideANamespace(S));
say("not exported again", () => String(re.notReexported) + notReexported(7));
function passedToItself(x: unknown) { return typeof x === "function" ? (x as (y: unknown) => string)(S) : "passedToItself " + typeof x + ":" + String(x); }
say("passed to itself", () => passedToItself(passedToItself));
function onlyNumbers(x: number) { return "onlyNumbers " + typeof x + ":" + String(x); }
say("only numbers", () => onlyNumbers(5));
say("the callee of one call, an argument of another", () => onlyNumbers(6) + [S].map(onlyNumbers as unknown as (y: string) => string).join());
const { evaluate, callsBoth } = await import("./evals");
say("both, with numbers", () => callsBoth() + notSeenByEval(3));
say("eval names an import", () => { const f = evaluate("typeof seenByEval === 'function' ? seenByEval : null"); return f ? f(S) : "renamed"; });
say("with numbers, again", () => askedForByName(1) + askedForByNameToo(2) + notAskedFor(3));
const lazily = () => import.meta.require("./extra.js");
say("import.meta.require", () => Object.keys(lazily()).join());
say("import.meta.require, an alias", () => lazily().underAnAlias(S));
say("import.meta.require, inside an object", () => lazily().wrapped.askedForByNameToo(S));
console.log(out.join("\n"));
