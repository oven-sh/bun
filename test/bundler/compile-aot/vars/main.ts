import { live, setLive, neverWrittenAgain, hoisted, initHoisted, counter, bump, declared, replaceDeclared, Klass, table, list, pattern } from "./other";
import * as ns from "./other";
import * as pathOfNode from "node:path";
import * as osOfNode from "node:os";
import defaultOfEvents, * as eventsOfNode from "node:events";
const readAtTheTop = typeof pathOfNode.join + typeof osOfNode.EOL + typeof eventsOfNode.defaultMaxListeners + typeof defaultOfEvents.once;
const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
const use = (x: any) => { if (typeof x === "function") return "function:" + x.length + ";"; let r = typeof x + ":"; try { r += String(x + 1) + "," + String(x?.length) + "," + String(x * 2) + "," + (x ? "t" : "f") + "," + (x === undefined) + "," + (x == null); } catch (e: any) { r += e.name; } return r; };
const values: any[] = [1, 1.5, "s", true, null, undefined, [1], { a: 1 }, () => 1, 10n, Symbol.iterator, new Map(), /x/];

let onlyInts: any = 1;
say("only ints", () => use(onlyInts));
function setOnlyInts() { onlyInts = 2; }
setOnlyInts();
say("only ints, still", () => use(onlyInts));
let changes: any = 1;
const readChanges = () => use(changes);
const writeChanges = (v: any) => { changes = v; };
for (const v of values) { writeChanges(v); say("changes", readChanges); }
var aVar: any;
say("a var, before", () => use(aVar));
aVar = "now";
say("a var, after", () => use(aVar));
say("before it is initialized", () => use(tooEarly));
let tooEarly: any = 5;
say("after it is initialized", () => use(tooEarly));
const readsLater = () => use(later);
say("a function that reads it too early", readsLater);
const later: any = "later";
say("and then not", readsLater);
let neverInitialized: any;
say("never initialized", () => use(neverInitialized));
let compound: any = 1;
const compounds = () => { compound += 1; const a = use(compound); compound += "s"; const b = use(compound); compound = 3; compound++; const c = use(compound); compound **= 40; return a + b + c + use(compound); };
say("compound", compounds);
let logical: any = null;
say("logical", () => { logical ??= "was null"; const a = use(logical); logical &&= 0; const b = use(logical); logical ||= [7]; return a + b + use(logical); });
let d1: any = 0, d2: any = 0, d3: any = 0;
const destructure = (o: any) => { ({ a: d1, b: [d2, ...d3] } = o); };
destructure({ a: "x", b: [true, 1, 2] });
say("destructured", () => use(d1) + use(d2) + use(d3));
let loopVariable: any = 0;
const overArray = () => { const seen = []; for (loopVariable of values.slice(0, 5)) seen.push(use(loopVariable)); return seen.join(); };
say("for of", overArray);
const overKeys = () => { for (loopVariable in { k: 1 }) ; return use(loopVariable); };
say("for in", overKeys);
let inHandlers: any = 1;
const handlers = (fail: boolean) => { try { if (fail) throw "thrown"; inHandlers = 2.5; } catch (e) { inHandlers = e; } finally { out.push("finally " + use(inHandlers)); } return use(inHandlers); };
say("no failure", () => handlers(false));
say("failure", () => handlers(true));
function reassignedDeclaration() { return "the declaration"; }
say("a declaration", () => use(reassignedDeclaration) + reassignedDeclaration());
(reassignedDeclaration as any) = "no longer a function";
say("a declaration, reassigned", () => use(reassignedDeclaration));
say("a declaration, reassigned and called", () => (reassignedDeclaration as any)());
class AClass { static s: any = 1; }
say("a class", () => use(AClass) + AClass.s);
let byEval: any = 1;
const evaluates = (code: string) => eval(code);
say("eval, before", () => use(byEval));
say("eval", () => { evaluates("byEval = 'from eval'"); return use(byEval); });

function counterMaker() { let n: any = 0; return { next: () => ++n, set: (v: any) => { n = v; }, get: () => use(n) }; }
say("a closure", () => { const c = counterMaker(); c.next(); const a = c.get(); c.set("s"); const b = c.get(); c.set(null); return a + b + c.get(); });
say("two of them", () => { const a = counterMaker(), b = counterMaker(); a.set([1]); b.set(2.5); return a.get() + b.get(); });
function twoDeep() { let v: any = 1; const outer = () => { const inner = (x: any) => { v = x; }; return inner; }; return { write: outer(), read: () => use(v) }; }
say("two deep", () => { const t = twoDeep(); const a = t.read(); t.write({}); return a + t.read(); });
function parameters(p: any, q: any = () => p) { const before = use(p); const set = (v: any) => { p = v; }; set("changed"); return before + use(p) + use(q()); }
say("parameters", () => parameters(1) + parameters([2]));
function perIteration() { const fs: (() => string)[] = []; for (let i: any = 0; i < 3; i++) { fs.push(() => use(i)); if (i === 1) { const j = i; i = "1"; fs.push(() => use(i)); i = j; } } return fs.map(f => f()).join(); }
say("per iteration", perIteration);
function shadowing() { let x: any = 1; const a = () => use(x); { let x: any = "inner"; const b = () => use(x); { let x: any = [3]; const c = () => use(x); return a() + b() + c(); } } }
say("shadowing", shadowing);
function siblings() { const fs = []; { let a: any = 1; fs.push(() => use(a)); } { let b: any = "two"; fs.push(() => use(b)); } { let c: any = null; fs.push(() => use(c)); } return fs.map(f => f()).join(); }
say("siblings", siblings);
function caught() { try { throw [1, 2]; } catch (e: any) { const read = () => use(e); const a = read(); e = "reassigned"; return a + read(); } }
say("caught", caught);
const itself = function named(n: number): string { const read = () => use(named); return n ? named(n - 1) : read(); };
say("its own name", () => itself(2));
function* generates() { let v: any = 1; const read = () => use(v); yield read(); v = "s"; yield read(); v = yield read(); yield read(); }
say("a generator", () => { const g = generates(); return [g.next().value, g.next().value, g.next().value, g.next([9]).value].join(); });
function* localsOfAGenerator(): Generator<string, void, any> { let v: any = 1; yield use(v); v = "s"; yield use(v); v = yield use(v); yield use(v); }
say("locals of a generator", () => { const g = localsOfAGenerator(); return [g.next().value, g.next().value, g.next().value, g.next({}).value].join(); });
class WithPrivate { #p: any = 1; static #s: any = "static"; get() { return use(this.#p) + use(WithPrivate.#s); } set(v: any) { this.#p = v; WithPrivate.#s = v; } }
say("private", () => { const w = new WithPrivate(); const a = w.get(); w.set([1]); return a + w.get(); });
function evalInside(code: string) { let local: any = 1; const read = () => use(local); const a = read(); eval(code); return a + read(); }
say("eval inside", () => evalInside("local = 'from eval'"));
function evalDeeper(code: string) { let outer: any = 1; const read = () => use(outer); function inner() { eval(code); } inner(); return read(); }
say("eval deeper", () => evalDeeper("outer = ['from eval']"));

say("live", () => use(live));
for (const v of values.slice(0, 8)) { setLive(v); say("live, written there", () => use(live)); }
say("never written again", () => use(neverWrittenAgain));
say("hoisted, before", () => use(hoisted));
initHoisted();
say("hoisted, after", () => use(hoisted));
say("counter", () => { const a = use(counter); bump(); bump(); return a + use(counter); });
say("declared", () => use(declared) + declared());
replaceDeclared(42);
say("declared, replaced", () => use(declared));
say("a class over there", () => use(Klass) + Klass.tag);
say("a map", () => table.get("a") + table.size + String(table.has("b")));
say("a list", () => { list.push(1, "b"); return list.length + list.join(); });
say("a pattern", () => String(pattern.test("caat")) + pattern.lastIndex);
say("the namespace", () => use(ns) + Object.keys(ns).length + use(ns.live) + use((ns as any)["coun" + "ter"]));

async function acrossAwaits() { let v: any = 1; const read = () => use(v); const a = read(); await null; v = "after"; const b = read(); v = await Promise.resolve([1]); return a + b + read() + use(v); }
out.push("across awaits = " + await acrossAwaits());
async function localsAcrossAwaits(x: any) { let v: any = x; const a = use(v); await null; const b = use(v); v = await Promise.resolve("s"); await null; return a + b + use(v); }
out.push("locals across awaits = " + await localsAcrossAwaits(1) + await localsAcrossAwaits(null));
const importsLater = () => import("./dyn");
function importsLaterToo() { return import("./dyn"); }
const knownLocation = () => typeof import.meta + typeof import.meta.url + typeof import.meta.dirname;
function whereItIsToo() { const inner = () => import.meta; return typeof inner().path; }
say("import.meta", () => knownLocation() + whereItIsToo());
out.push("import() in functions = " + typeof (await importsLater()).seenFromHere + typeof (await importsLaterToo()).writeFromHere);
const dyn: any = await import("./dyn");
say("from a third", () => dyn.seenFromHere());
say("written from a third", () => { dyn.writeFromHere({ toString() { return "object"; } }); return dyn.seenFromHere() + use(live) + use(counter); });
let takenFromAnArray: unknown = 0;
function fillsIt(a: unknown[]) { a.push({ toString() { return "object"; } }, "s", 2.5); }
function isPassedIt(x: unknown) { return typeof x + ":" + String(x) + " "; }
function readsItInALoop() {
  const a: unknown[] = [];
  fillsIt(a);
  let text = "";
  for (let i = 0; i < a.length; i++) { const element = a[i]; takenFromAnArray = element; text += isPassedIt(element); }
  return text;
}
say("filled by somebody else", () => readsItInALoop() + use(takenFromAnArray));
say("namespaces of builtins, at the top", () => readAtTheTop);
say("namespaces of builtins, in a function", () => pathOfNode.join("a", "b") + typeof osOfNode.platform() + (eventsOfNode.once === defaultOfEvents.once) + Object.keys(pathOfNode).includes("join"));
say("a namespace of a builtin as a value", () => { const all: any[] = [pathOfNode, osOfNode, fsOfNode]; return all.map(n => Object.prototype.toString.call(n)).join(); });
say("the namespace of what is imported later", () => Object.keys(dyn).sort().join() + ";" + Object.keys(dyn).map(k => typeof dyn[k]).join());
say("what it does not export", () => String(dyn.notExportedByIt) + ("notExportedByIt" in dyn));
console.log(out.join("\n"));
