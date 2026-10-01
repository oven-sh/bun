import { farAdd, farArgs, farBack, farCounts, farFirstFromNative } from "./other";
const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};

// ---- callees
function add(a: number, b: number) { return a + b; }
function sub(a: number, b: number) { return a - b; }
function three(a: any, b: any, c: any) { return a + "," + b + "," + c; }
function seesArguments(a?: any, b?: any) { return arguments.length + ":" + Array.prototype.join.call(arguments); }
function seesThis(this: any, a: any) { return typeof this + ":" + a; }
function wantsMore(a: any, b: any, c: any, d: any, e: any) { return [a, b, c, d, e].map(String).join(); }
function withDefault(a: number, b = a * 2, c = b + 1) { return a + ":" + b + ":" + c; }
function withRest(a: number, ...rest: number[]) { return a + ":" + rest.length + ":" + rest.join(); }
function none() { return "none"; }
function namesItself(n: number): any { return n ? typeof namesItself + namesItself.length : "z"; }
function throws(a: number): number { throw new RangeError("thrown with " + a); }
async function isAsync(a: number, b: number) { await null; return a * b; }
function* isGenerator(a: number, b: number) { yield a; yield b; }
const arrow = (a: number, b: number) => a * 10 + b;
const expression = function (a: number, b: number) { return a * 100 + b; };
let reassigned = (a: number, b: number) => a + b;
reassigned = (a: number, b: number) => a - b;
class Klass { constructor(public a: number) {} }

function addAny(a: any, b: any) { return a + "+" + b; }
function withRestAny(a: any, ...rest: any[]) { return a + ":" + rest.length + ":" + rest.join(); }
function sameAny(a: any, b: any) { return addAny(a, b); }
function swappedAny(a: any, b: any) { return addAny(b, a); }
function fewerAny(a: any, b: any, c: any, d: any) { return addAny(c, d); }
function toRestAny(a: any, b: any, c: any) { return withRestAny(c, b, a); }
function usesOwnArgumentsAny(a: any, b: any) { const n = arguments.length; return addAny(n, b); }
function readsOwnArgumentsAny(a: any, b: any) { const last = arguments[arguments.length - 1]; return addAny(last, a); }

// ---- as many arguments as parameters, fewer, more
function same(a: number, b: number) { return add(a, b); }
function swapped(a: number, b: number) { return sub(b, a); }
function rotated(a: any, b: any, c: any) { return three(c, a, b); }
function repeated(a: any, b: any, c: any) { return three(b, b, b); }
function computed(a: number, b: number, c: number) { return three(a + b, b * c, a - c); }
function fewer(a: number, b: number, c: number, d: number) { return add(c, d); }
function fewest(a: number, b: number, c: number) { return none(); }
function tooMany(a: number) { return three(a, a + 1, a + 2); } // Not in the frame of the caller.
function constants(a: number, b: number, c: number) { return three(1, "two", null); }
function toArguments(a: any, b: any) { return seesArguments(b, a); }
function toArgumentsOne(a: any, b: any) { return seesArguments(b); }
function toArgumentsNone(a: any, b: any) { return seesArguments(); }
function toThis(this: any, a: any) { return seesThis(a); }
function toMore(a: any, b: any) { return wantsMore(b, a); }
function toMoreOne(a: any, b: any, c: any) { return wantsMore(c); }
function toDefault(a: number, b: number) { return withDefault(b); }
function toDefault2(a: number, b: number) { return withDefault(b, a); }
function toRest(a: number, b: number, c: number) { return withRest(c, b, a); }
function toRestOne(a: number, b: number, c: number) { return withRest(c); }
function toSelfNamed(a: number) { return namesItself(a); }
function toThrows(a: number) { return throws(a); }
function toAsync(a: number, b: number) { return isAsync(b, a + 1); }
function toGenerator(a: number, b: number) { return isGenerator(b, a); }
function toArrow(a: number, b: number) { return arrow(b, a); }
function toExpression(a: number, b: number) { return expression(b, a); }
function toReassigned(a: number, b: number) { return reassigned(b, a); }
function toClass(a: number) { return (Klass as any)(a); }
function toFar(a: number, b: number) { return farAdd(b, a * 2); }
function toFarArgs(a: any, b: any, c: any) { return farArgs(c, a); }
function toFarCounts(a: number) { return farCounts(a); }
function conditional(a: number, b: number) { return a > b ? add(a, b) : sub(a, b); }
function logical(a: number, b: number) { return a && add(a, b); }
function comma(a: number, b: number) { return (out.length, add(b, a)); }
function usesOwnArguments(a: number, b: number) { const n = arguments.length; return add(n, b === undefined ? -1 : b); }
function storesToParameter(a: number, b: number) { a = b * 2; b = a + 1; return sub(a, b); }
function closesOver(a: number, b: number) { const f = () => a + b; keep = f; return add(b, a + 1); }
let keep: () => number = () => 0;
function inTry(a: number, b: number) { try { return add(a, b); } catch { return -1; } }
function inFinally(a: number, b: number) { try { a++; } finally { b++; } return add(a, b); }
function manyLocals(a: number, b: number) {
  let s = 0; const xs = [a, b, a + b, a * b, a - b, a | b, a & b, a ^ b];
  for (let i = 0; i < xs.length; i++) s += xs[i] * (i + 1);
  const p = s + a, q = s - b, r = p * q, t = r % 97, u = t + p, v = u - q, w = v ^ r;
  return three(w + t, u + v, p + q + s);
}
function twelve(a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any) { return eleven(k, j, i, h, g, f, e, d, c, b, a); }
function eleven(a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any) { return [a, b, c, d, e, f, g, h, i, j, k].join(""); }
function thirteen(a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any, m: any) { return thirteenTo(m, l, k, j, i, h, g, f, e, d, c, b, a); }
function thirteenTo(a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any, m: any) { return [a, b, c, d, e, f, g, h, i, j, k, l, m].join(""); }
function doubles(a: number, b: number) { return add(a * 0.5, b / 3); }
function mixed(a: any, b: any, c: any) { return three(a?.x, b?.[0], typeof c); }

for (let round = 0; round < 3; round++) {
  say("same", () => same(1, 2));
  say("swapped", () => swapped(1, 5));
  say("rotated", () => rotated("a", "b", "c"));
  say("repeated", () => repeated("a", "b", "c"));
  say("computed", () => computed(2, 3, 4));
  say("fewer", () => fewer(1, 2, 3, 4));
  say("fewest", () => fewest(1, 2, 3));
  say("tooMany", () => tooMany(7));
  say("constants", () => constants(1, 2, 3));
  say("toArguments", () => toArguments("x", "y"));
  say("toArgumentsOne", () => toArgumentsOne("x", "y"));
  say("toArgumentsNone", () => toArgumentsNone("x", "y"));
  say("toThis", () => toThis.call({ k: 1 }, "v"));
  say("toMore", () => toMore("x", "y"));
  say("toMoreOne", () => toMoreOne("x", "y", "z"));
  say("toDefault", () => toDefault(1, 5));
  say("toDefault2", () => toDefault2(1, 5));
  say("toRest", () => toRest(1, 2, 3));
  say("toRestOne", () => toRestOne(1, 2, 3));
  say("toSelfNamed", () => toSelfNamed(1) + toSelfNamed(0));
  say("toThrows", () => toThrows(9));
  say("toGenerator", () => [...toGenerator(1, 2)].join());
  say("toArrow", () => toArrow(1, 2));
  say("toExpression", () => toExpression(1, 2));
  say("toReassigned", () => toReassigned(1, 2));
  say("toClass", () => toClass(1));
  say("toFar", () => toFar(1, 2));
  say("toFarArgs", () => toFarArgs("p", "q", "r"));
  say("toFarCounts", () => toFarCounts(3));
  say("conditional", () => conditional(5, 2) + "," + conditional(2, 5));
  say("logical", () => logical(0, 2) + "," + logical(3, 2));
  say("comma", () => comma(1, 2));
  say("storesToParameter", () => storesToParameter(1, 2));
  say("closesOver", () => closesOver(1, 2) + "," + keep());
  say("inTry", () => inTry(1, 2));
  say("inFinally", () => inFinally(1, 2));
  say("manyLocals", () => manyLocals(3, 4));
  say("twelve", () => twelve(1, 2, 3, 4, 5, 6, 7, 8, 9, "a", "b"));
  say("thirteen", () => thirteen(1, 2, 3, 4, 5, 6, 7, 8, 9, "a", "b", "c", "d"));
  say("doubles", () => doubles(3, 1));
  say("mixed", () => mixed({ x: 1 }, [2], () => 0));

  // ---- the caller was passed fewer than it has parameters, or more
  say("same()", () => (same as any)());
  say("same(1)", () => (same as any)(1));
  say("same(1,2,3,4,5)", () => (same as any)(1, 2, 3, 4, 5));
  say("rotated(1)", () => (rotated as any)(1));
  say("rotated x7", () => (rotated as any)(1, 2, 3, 4, 5, 6, 7));
  say("toArguments()", () => (toArguments as any)());
  say("toArguments x5", () => (toArguments as any)(1, 2, 3, 4, 5));
  say("toMore()", () => (toMore as any)());
  say("toMore x6", () => (toMore as any)(1, 2, 3, 4, 5, 6));
  say("toRest(1)", () => (toRest as any)(1));
  say("usesOwnArguments", () => [(usesOwnArguments as any)(), (usesOwnArguments as any)(1), usesOwnArguments(1, 2), (usesOwnArguments as any)(1, 2, 3)].join());
  say("fewer(1)", () => (fewer as any)(1));
  say("sameAny()", () => sameAny());
  say("sameAny(1)", () => sameAny(1));
  say("sameAny x5", () => sameAny(1, 2, 3, 4, 5));
  say("swappedAny", () => [swappedAny(), swappedAny(1), swappedAny(1, 2), swappedAny(1, 2, 3)].join("|"));
  say("fewerAny", () => [fewerAny(), fewerAny(1), fewerAny(1, 2, 3), fewerAny(1, 2, 3, 4), fewerAny(1, 2, 3, 4, 5, 6)].join("|"));
  say("toRestAny", () => [toRestAny(), toRestAny(1), toRestAny(1, 2, 3), toRestAny(1, 2, 3, 4, 5)].join("|"));
  say("usesOwnArgumentsAny", () => [usesOwnArgumentsAny(), usesOwnArgumentsAny(1), usesOwnArgumentsAny(1, 2), usesOwnArgumentsAny(1, 2, 3)].join("|"));
  say("readsOwnArgumentsAny", () => [readsOwnArgumentsAny(), readsOwnArgumentsAny(1), readsOwnArgumentsAny(1, 2), readsOwnArgumentsAny(1, 2, 3, 4)].join("|"));
  say("any by apply", () => [sameAny.apply(null, []), sameAny.apply(null, [4]), sameAny.apply(null, [4, 5, 6, 7])].join("|"));
  say("any bound", () => [sameAny.bind(null)(), sameAny.bind(null, 7)(), sameAny.bind(null, 7, 8, 9)(10)].join("|"));
  say("any from map", () => [1, 2].map(sameAny).join("|") + "/" + [1, 2].map(fewerAny).join("|"));
  say("by apply", () => same.apply(null, [4, 5]) + "," + (same as any).apply(null, [4]) + "," + (same as any).apply(null, [4, 5, 6, 7]));
  say("by call", () => rotated.call(null, 1, 2, 3) + "|" + (rotated as any).call(null, 1));
  say("by spread", () => (rotated as any)(...[1, 2, 3, 4, 5, 6, 7, 8, 9]) + "|" + (rotated as any)(...[]));
  say("bound", () => same.bind(null, 7)(8) + "," + (same as any).bind(null)(1) + "," + (rotated as any).bind(null, 1, 2, 3, 4)(5));
  say("Reflect.apply", () => Reflect.apply(rotated, null, [1, 2, 3]) + "|" + Reflect.apply(rotated as any, null, []));
}

// ---- called by native code
function first1(a: number, i: number) { return firstFromNative1(a, i); }
function firstFromNative1(a: number, i: number) { return "first:" + a + ":" + i; }
say("first call, from map", () => [10, 20].map(first1).join("|"));
function first2(a: number, i: number) { return farFirstFromNative(a, i); }
say("first call of another module's, from map", () => [10, 20].map(first2).join("|"));
function first3(a: number, b: number) { return firstFromNative3(b, a); }
function firstFromNative3(a: number, b: number) { return a - b; }
say("first call, from sort", () => [3, 1, 2].sort(first3).join());
function first4(this: any, k: string, v: any) { return firstFromNative4(v, k); }
function firstFromNative4(v: any, k: string) { return typeof v === "number" ? v + k.length : v; }
say("first call, from JSON.parse", () => JSON.stringify(JSON.parse('{"ab":1,"cde":2}', first4)));
function first5(acc: number, x: number) { return firstFromNative5(x, acc); }
function firstFromNative5(x: number, acc: number) { return acc * 2 + x; }
say("first call, from reduce", () => [1, 2, 3].reduce(first5, 0));
function first6(m: string, p: string) { return firstFromNative6(p, m); }
function firstFromNative6(p: string, m: string) { return "<" + p + "/" + m + ">"; }
say("first call, from replace", () => "a1b2".replace(/[a-z](\d)/g, first6));

// ---- however deep, no deeper
function count(n: number, acc: number) { return n ? count(n - 1, acc + 1) : acc; }
function even(n: number) { return n ? odd(n - 1) : true; }
function odd(n: number) { return n ? even(n - 1) : false; }
function shrinks(n: number, a: number, b: number, c: number) { return n ? grows(n - 1, a + b + c) : a; }
function grows(n: number, a: number) { return n ? shrinks(n - 1, a, 1, 1) : a; } // This one is not in the frame of the caller.
function padded(n: number, acc: number, x?: any, y?: any, z?: any) { return n ? padded(n - 1, acc + 1) : acc + (x === undefined && y === undefined && z === undefined ? 0 : 1e9); }
say("count", () => count(1_000_000, 0));
say("even", () => even(1_000_001));
say("shrinks", () => shrinks(300_000, 0, 1, 1));
say("padded", () => padded(500_000, 0));
say("padded, passed more", () => (padded as any)(500_000, 0, 1, 2, 3, 4, 5, 6));
say("across modules", () => farBack(600_000, 0));
function notATailCall(n: number): number { return n ? 1 + notATailCall(n - 1) : 0; }
say("not a tail call", () => { try { return notATailCall(10_000_000); } catch (e: any) { return e.name; } });

// ---- before it is initialized
say("var, not yet", () => early(1, 2));
function early(a: number, b: number) { return later(a, b); }
var later = function (a: number, b: number) { return a + b; };
say("var, by now", () => early(1, 2));
say("const, not yet", () => early2(1, 2));
function early2(a: number, b: number) { return later2(a, b); }
const later2 = (a: number, b: number) => a * b;
say("const, by now", () => early2(3, 4));

say("not in tail position, not yet", () => early3(1, 2));
function early3(a: number, b: number) { const r = later3(a, b); return r; }
const later3 = (a: number, b: number) => a * b;
say("constructed, not yet", () => early4(1));
function early4(a: number) { const r = new Later4(a); return r.a; }
const Later4 = function (this: any, a: number) { this.a = a; } as any;
say("constructed, by now", () => early4(6));

// ---- who is on the stack
function top(a: number) { return middle(a); }
function middle(a: number) { return bottom(a); }
function bottom(a: number) { return new Error("e" + a).stack!.split("\n").filter(l => /\b(top|middle|bottom)\b/.test(l)).map(l => /\b(top|middle|bottom)\b/.exec(l)![1]).join(">"); }
say("stack", () => top(1));
function throwsDeep(a: number): number { return throwsDeeper(a); }
function throwsDeeper(a: number): number { return throws(a); }
say("caught", () => { try { return throwsDeep(4); } catch (e: any) { return e.message + " " + e.stack.split("\n").filter((l: string) => /throws/.test(l)).length; } });

// ---- garbage collected in the middle
function allocates(a: any, b: any): any { const junk = []; for (let i = 0; i < 50; i++) junk.push({ i, a }); return holds({ v: junk.length }, b); }
function holds(a: any, b: any) { Bun.gc(true); return a.v + ":" + b.w; }
say("gc", () => allocates({ q: 1 }, { w: 2 }));

const settled = await Promise.all([toAsync(2, 3), toAsync(4, 5)]);
say("toAsync(1)", () => (toAsync as any)(1));
out.push("async = " + settled.join());
await Promise.resolve(5).then(function viaThen(v: number) { return afterThen(v); }).then(v => out.push("then = " + v));
function afterThen(v: number) { return "after:" + v; }
console.log(out.join("\n"));
