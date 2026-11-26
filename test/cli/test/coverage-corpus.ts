// Programs for coverage.test.ts. `«2»` is where the report has an entry, and its count.

/** An `else` that is not written is at its `if`. */
export const branches: Record<string, string> = {
  "if.js": `
function f(v, o) {
  let r;
  «2»«1»if (v) r = 1;
  «2»if (v) r = 1;
  else «1»«0»if (o) r = 2;
  else «1»r = 3;
  «2»«1»if (v);
  «2»if (v);
  else«1»;
  «2»if (v) {
  } else «1»{
  }
  «2»«1»if (v) label: r = 1;
  r = v ? «2»1 : «1»2;
  r = v ? «2»() => 1 : «1»o ? «0»2 : «1»3;
  return r;
}
f(1, {});
f(2, {});
f(0, null);
function never(v) {
  «0»«0»if (v) return v ? «0»1 : «0»«0»v && «0»2;
}
`,
  "operands.js": `
function values(yes, no, nothing) {
  let r;
  r = «1»yes && «1»no;
  r = «1»no && «0»yes;
  r = «1»yes || «0»no;
  r = «1»no || «1»yes;
  r = «1»yes ?? «0»no;
  r = «1»nothing ?? «1»yes;
  r = «1»nothing ?? «1»nothing ?? «1»yes;
  r = («1»yes && «1»no) || «1»yes;
  r = «1»yes && («1»no || «1»yes);
  r = («1»nothing ?? «1»no) || «1»yes;
  r = («1»yes && («1»nothing ?? «1»no)) || «1»yes;
  r = «1»!(«1»yes && «1»no) && «1»yes;
  r = «1»no || «1»"constant";
}
values(1, 0, null);
function tests(a, b) {
  «1»«1»if («2»a && «1»b) a;
  «2»«0»if («2»a || «1»b) a;
  «1»«1»if (!(«2»a && «1»b)) a;
  «0»«2»if («2»a && «1»!b) a;
  «2»«0»if ((«2»a && «1»b) || «1»b) a;
  «1»«1»if ((«2»a || «1»b) && «2»a) a;
  «1»«1»if («2»a ?? «0»b) a;
  while («2»a && «1»!b) break;
  return «2»a && «1»b ? «1»1 : «1»2;
}
tests(1, 1);
tests(0, 1);
function constants(v) {
  let r = «1»[] && «1»v;
  «0»«1»if («1»!v || «1»null) r;
  «0»«1»if («1»!v || «1»!1) r;
  «1»«0»if («1»!v || «1»!(«1»!v || «1»!v)) r;
}
constants(1);
function throws(a) {
  try {
    return «1»a.b && «0»a;
  } catch {
    return 1;
  }
}
throws(null);
`,
  "constants.tsx": `
/** @jsxRuntime classic */
/** @jsx Object */
const v = Object();
Object(«1»undefined || «1»v, «1»void v || «1»v, «1»1 && «1»v, «1»1n && «1»v, «1»"a" && «1»v, «1»/a/ && «1»v);
Object(«1»{} && «1»v, «1»function () {} && «1»v, «1»class {} && «1»v, «1»new Object() && «1»v, «1»<a /> && «1»v);
Object(<T,>(a: T) => «0»a || «0»v, Object<string>(«1»v || «0»v));
`,
  // They start before what they start with.
  "parentheses.ts": `
function f(v: any, g: any) {
  let r;
  r = v ? «1»(r) = 1 : «1»(r)++;
  r = v ? «1»(r)-- : «1»(r)!;
  r = v ? «1»(r) satisfies any : «1»(1) as const;
  r = v ? «1»(g)<any> : «1»(g)\`\`;
  r = v ? «1»@g class {} : «1»r;
  r = [v, («2»v || «1»g) as any];
  r = (v«1»?.a!«0»?.b)«0»?.c;
}
f(1, Object);
f(null, Object);
`,
  "export.cts": `
export = «1»Object || «0»Array;
`,
  "places.js": `
function everywhere(v, o) {
  let r;
  for (r = v ? «1»1 : «0»2; r < 0; ) r++;
  for (const a of v ? «1»[] : «0»o) r++;
  switch (v ? «1»1 : «0»2) {
    «1»default:
  }
  const { [v ? «1»"a" : «0»"b"]: a } = o;
  ({ [v ? «1»"a" : «0»"b"]: r } = o);
  [(v ? «1»o : «0»r).c = «1»1] = [];
  r = o[v ? «1»"a" : «0»"b"];
  r = v + («1»v || «0»o) * 1;
  r = [...(v ? «1»[] : «0»o)];
  r = (function* () { yield v ? «1»1 : «0»2; })().next();
  r = (v ? «1»String : «0»Number)\`\${v ? «1»1 : «0»2}\`;
  r = new (v ? «1»String : «0»Number)(v ? «1»1 : «0»2);
}
everywhere(1, {});
const fail = () => null.a;
function attempt(f) {
  try {
    f(0, null);
  } catch {
    f = null;
  }
}
// What comes first throws.
attempt((v, n) => fail()(«0»v || «0»n));
attempt((v, n) => v«1»?.a.b(«0»v || «0»n));
attempt((v, n) => (fail().a = «0»v || «0»n));
attempt((v, n) => fail() + («0»v || «0»n));
attempt((v, n) => fail()\`\${«0»v || «0»n}\`);
attempt((v, n) => new (fail())(«0»v || «0»n));
attempt((v, n) => ({ a: fail(), b: «0»v || «0»n }));
attempt((v, n) => [fail(), «0»v || «0»n]);
attempt((v, n) => { const { [«0»v || «0»n]: a } = fail(); });
attempt((v, n) => ([(«0»v || «0»n).a] = fail()));
attempt((v, n) => ({ [«0»v || «0»n]: v } = fail()));
// What comes next throws.
attempt((v, n) => { for ((«1»v || «1»n).a of [1]) v++; });
attempt((v, n) => { try { throw {}; } catch ({ [«1»v || «1»n]: a = «1»fail() }) { v = a; } });
attempt((v, n) => (({ [«1»v || «1»n]: a }, b = «1»fail()) => a)({}));
`,
  "with.cjs": `
with («1»exports || «0»module) module ? «1»1 : «0»2;
`,
  "assignments.js": `
function f(a, o) {
  a ||= «1»1;
  a &&= «3»2;
  o.b ??= «1»3;
  o["c"] ??= «3»() => 4;
}
f(0, {});
f(1, { b: 1 });
f(1, { b: 1 });
`,
  "chains.js": `
function f(o) {
  let r;
  r = o«2»?.a;
  r = o«2»?.a«1»?.b;
  r = o«2»?.a«1»?.b.c(«1»o && «1»1);
  r = o«2»?.["a"];
  r = o«2»?.f«0»?.();
  r = (o«2»?.a)«1»?.b;
  r = ((o«2»?.a)«1»?.b)«1»?.["c"];
  r = (o«2»?.f)«0»?.();
  r = (o«2»?.toString())«2»?.a;
  r = (o«2»?.valueOf().f)«0»?.();
  r = (o«2»?.a«1»?.b.c())«0»?.();
  r = («3»o || «1»r)«2»?.a;
  r = (o«2»?.[String("a")]«1»?.b)«1»?.c;
  try {
    r = (o«2»?.a).b«1»?.c;
  } «2»catch {}
  r = «3»o«2»?.a && «1»1;
  r = «3»o«2»?.a ?? «2»1;
  r = o
    «2»?.a /* ?. */
    «1»?.b;
  r = /a/«3»?.test("a");
  delete o«2»?.z;
}
f({ a: { b: { c() {} } } });
f({ a: null });
f(null);
`,
  "defaults.js": `
function parameters(a = «1»1, { b = «2»2 } = «2»{}, [c = «2»3] = «2»[]) {
  return (d = «0»a) => d;
}
parameters();
parameters(0);
function patterns(o, list) {
  let r;
  const { a = «2»1, b: { c = «3»2 } = «3»{} } = o;
  const [d = «1»3] = list;
  [r = «1»4] = list;
  [r = 5][0] = o;
  [(r = {}).x] = list;
  [...[r = «1»6]] = list;
  ({ r = «3»7, a: r = «2»8 } = o);
  for (const [e = «1»9] of [list]);
  for ({ r = «3»10 } of [o]);
  try {
    throw o;
  } catch ({ a = «2»11 }) {
    r = a;
  }
}
patterns({ a: 1 }, [1]);
patterns({}, []);
patterns({}, [1]);
`,
  "loops.js": `
function runOut(a, b) {
  do «0»«3»if (!runOut) break;
  while («3»a-- && «2»b--);
  while («4»a++ && «3»b++) «0»«2»if (!runOut) break;
  for (; «4»a-- && «3»b--; ) «0»«2»if (!runOut) break;
  for (const key in { a }) «0»«2»if (!runOut) break;
}
runOut(0, 9);
runOut(9, 1);
function headers(n, list) {
  let i = 0;
  while («4»i < n && «3»list) i++;
  for (i = 0; «4»i < n || «1»!list; i += «3»list.step ?? «3»1);
  do i--;
  while («3»i > 0 && «2»list);
  for ((«2»list.t ?? «2»list).k in { a: 1, b: 2 });
}
headers(3, []);
`,
  "switch.js": `
function f(v, o) {
  switch (v) {
    «1»case 1:
      break;
    «1»case 2:
      break;
  }
  switch (v) {
    «1»case 1:
      break;
    «3»default:
  }
  switch (v) {
    «1»case 1:
    «1»case 3:
      f.last = v;
    «1»case 4: {
      break;
    }
    «1»case 2:
  }
  switch (v) {
    «3»default:
    «4»case 1:
  }
  switch (v) {
  }
  switch (v) {
    «1»case 1:
      return;
    «0»case «3»o && «2»o.a:
      break;
    «0»case o«2»?.a:
      break;
    «0»case (o ??= «1»{}):
  }
}
f(1, { a: 7 });
f(2, { a: 7 });
f(9, { a: 7 });
f(9, null);
`,
  "catch.js": `
function f(g) {
  try {
    g();
  } «1»catch {}
  try {
    f;
  } «0»catch (error) {}
  try {
    f;
  } «0»catch {;}
  try {
    f;
  } catch {
    f;
  } finally {
  }
}
f(null);
f(() => {});
`,
  "classes.ts": `
const mark = (value: any, context?: any) => value;
@((mark, mark) ? «1»mark : «0»mark)
class Fields {
  static none: any;
  a = «2»Fields.none ?? «2»1;
  static b = «1»this.none || «1»2;
  #c = Fields.none«0»?.c;
  @mark d = «2»Fields.none ?? «2»3;
  accessor e = «2»Fields.none ?? «2»4;
  [«1»mark.name || «0»"f"] = 5;
  static {
    «0»«1»if (this.none) mark;
  }
  constructor(public g = «1»6) {}
  #h(i = «0»7) {}
}
new Fields();
new Fields(1);
class Derived extends («1»Fields ?? «0»Object) {}
`,
  // The transpiler prints something else in their place.
  "replaced.ts": `
const M = 2;
enum Mode { A, B = «1»M || «0»3 }
function inlined(v: any, o: any, t = «3»M) {
  const L = 3;
  let r: any = «3»v ?? «1»L;
  r = «3»v || «2»Mode.A;
  r = v ? «1»L : «2»M;
  r = L ? «3»v : «0»1;
  r = «3»L && «3»v;
  r = «3»!(«3»v || «2»o) ?? «0»L;
  r = o«2»?.[L];
  r = (o«2»?.toString as any)«2»?.name;
  r ??= «1»L;
  r = (/* istanbul ignore next */ <any>o?.[v || L])«0»?.name;
  r = ((/* istanbul ignore next */ o?.[v || L]) as any)«0»?.name;
  const { x = «3»L } = «3»o ?? «1»{};
  r = «3»v && «1»process.env.NODE_ENV;
  r = «3»v && «1»import.meta.dir;
  r = require(v ? «1»"bun" : «2»"bun:test");
  r = require.resolve(v ? «1»"./if.js" : «2»"./loops.js");
  r = import(v ? «1»"./if.js" : «2»o ? «1»"./loops.js" : «1»"./catch.js");
  r = («3»v as number) || «2»<number>o || «1»o!;
  «1»«2»if ((«3»v && «1»o) as boolean) r = 1;
  r = «3»v && «1»require(o ? «1»"bun" : «0»"bun:test");
  r = «3»v && «1»require.resolve(o ? «1»"./if.js" : «0»"./loops.js");
  r = «3»v && «1»import(o ? «1»"./if.js" : «0»"./loops.js");
  r = «3»v && «1»"" + typeof o;
  r = «3»v && («1»import.meta.hot.data.a ??= «1»o);
}
inlined(1, {});
inlined(0, null);
inlined(null, {});
export default Mode ? «1»1 : «0»2;
`,
  // The code that the transpiler adds has branches, which are not in the file.
  "generated.tsx": `
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag h */
const h = (...all: any[]) => all;
enum Color { Red, Green = "g" }
export namespace Outer { export const a = Color.Red; export namespace Inner { export const b = 2; } }
function decorate(value: any, context: any) { return value; }
class Base { x = 1; static s = 2; constructor(public q: number, readonly r?: number) {} }
@decorate class Derived extends Base { @decorate m() { return this.x; } accessor a = 1; y?: number = 4; }
async function dispose() { using a = null; await using b = null; }
new Derived(1);
dispose();
const Children = ({ a, b, t }: any) => (
  <p {...(«1»a && «1»b)} title={«1»t ?? «1»"none"}>
    {(«1»a || «0»b).length ? «1»"some" : «0»<></>}
    {«1»t && «0»<br />}
  </p>
);
Children({ a: "a" });
const fail = (): any => (null as any).a;
try { <p a={fail()} b={«0»h || «0»fail} />; } «1»catch {}
try { <p a={fail()}>{«0»h || «0»fail}</p>; } «1»catch {}
try { enum Late { A = fail(), B = («0»h || «0»fail).length, /* istanbul ignore next */ C = (h || fail).length } } «1»catch {}
`,
  "hints.js": `
function nodes(v) {
  /* istanbul ignore if */
  «1»if (!v) v && v;
  /* istanbul ignore if */
  if (!v) v;
  «1»else «1»«0»if (v) v;
  /* istanbul ignore else */
  «1»if (v) v;
  /* istanbul ignore else */
  «1»if («1»v && «1»v) v;
  /* v8 ignore else -- with a reason */
  «1»if (v) v;
  else v && v;
  // istanbul ignore next
  if (v) {
    v && v;
  }
  /* v8 ignore next */
  if (v) {
    v && v;
  }
  «1»if (v) v;
  else /* istanbul ignore next */ v;
  v ? «1»v : /* istanbul ignore next */ v;
  «1»v || /* istanbul ignore next */ v;
  «1»v /* istanbul ignore next */ || v;
  «1»!v /* istanbul ignore next */ && v;
  «1»v /* istanbul ignore next */ ?? v;
  v /* istanbul ignore next */ ? v : «0»v;
  v ? «1»v /* istanbul ignore next */ : v;
  v /* istanbul ignore next */ , v ? v : v;
  v /* istanbul ignore next */ = v ? v : v;
  () /* istanbul ignore next */ => (v ? v : v);
  «1»if (v) v;
  /* istanbul ignore next */
  else v;
  v /* istanbul ignore next */ ?.a;
  v?./* istanbul ignore next */ a?.b(v || v);
  v ||= /* istanbul ignore next */ v || v;
  v /* istanbul ignore next */ ||= v;
  v /* istanbul ignore next */ &&= v;
  v /* istanbul ignore next */ ??= v;
  v /* istanbul ignore next */ === (v ? v : v);
  v /* istanbul ignore next */ ?.5 : «0»v;
  switch (v) {
    «1»case 1:
      break;
    /* istanbul ignore next */
    default:
  }
  const { /* istanbul ignore next */ a = 1, b = /* istanbul ignore next */ 2 } = { b: 1 };
  const [/* istanbul ignore next */ c = 1] = [], { /* istanbul ignore next */ key: d = 1 } = {};
  let e = 1, /* istanbul ignore next */ { f = 1 } = {};
  ({ /* istanbul ignore next */ key: e = 1 } = {});
  [/* istanbul ignore next */ e = 1] = [];
  (/* istanbul ignore next */ ...[g = 1]) => g;
  e = (/* istanbul ignore next */ v && v) || «0»v;
  e = (/* istanbul ignore next */ v?.a)«0»?.b;
  e = [/* istanbul ignore next */ v ? v : v];
  e = v ? /* istanbul ignore next */ (v) : «0»v;
  e = (/* istanbul ignore next */ Object(v || v)).a;
  /* istanbul ignore else */
  «1»if («1»v && «1»!(«1»!v || «1»!v)) v;
  try {
    v;
  } catch (error) /* istanbul ignore next */ {}
  try {
    v;
  } catch {
    // istanbul ignore next
  }
  try {
    v;
  } catch {
    // istanbul ignore next
    v ? v : v;
    v ? «0»v : «0»v;
  }
  "istanbul ignore next";
  v ? «1»v : «0»v;
  /* ignore next */
  /* eslint ignore next */
  /* coverage ignore next */
  /* node:c8 ignore next */
  /* istanbul ignore next_ */
  /* c8 disable */
  v ? «1»v : «0»v; /* c8 enable */
}
nodes(1);
function lines(v) {
  /* c8 ignore next */
  v ? v : v;
  v ? «1»v : «0»v;
  v ? v : v; /* c8 ignore next */
  v ? «1»v : «0»v;
  /* c8 ignore next 2 */
  v ? v : v;
  v ? v : v;
  v ? «1»v : «0»v;
  /* v8 ignore next 1 */
  if (!v) {
    v ? «0»v : «0»v;
  }
  v ? «1»v : «0»v; /* node:coverage ignore next */
  v ? v : v;
  /* node:coverage ignore next 2 */
  v ? v : v;
  v ? v : v;
  /* c8 ignore start */
  v ? v : v;
  /* c8 ignore stop */
  v ? «1»v : «0»v;
  /*istanbul ignore start*/
  v ? v : v;
  /*istanbul ignore end*/
  v ? «1»v : «0»v;
  /* node:coverage disable */
  v ? v : v;
  /* node:coverage enable */
  v ? «1»v : «0»v;
  «1»if (v) {
    v;
    /* c8 ignore next 3 */
  } else {
    v;
  }
  /* c8 ignore next */
  try { v?.a; } catch {}
  («1»!v || «1»!v) &&
    /* c8 ignore next */
    v;
  («1»v &&
    /* c8 ignore next */
    (v ?? v)) ||
    «0»v;
  «1»v && «1»v
    ? «1»v
    /* c8 ignore next */
    : v;
  /* v8 ignore start */
  v ? v : v;
}
lines(1);
`,
};

export const statements: Record<string, string> = {
  "statements.ts": `
"use strict";
import { value } from "./dropped.ts";
import type { Stats } from "node:fs";
type A = Stats;
interface B {}
declare const c: A;
let unset;
const one = «1»1, two = «1»one + 1;
function fails() {
  «2»throw value;
  const late = «0»1;
  «0»fails();
}
«1»try {
  «1»unset = two; «1»fails(); «0»unset = one;
} catch {
  «1»debugger;
} finally {
  ;
}
«1»try {
  var before = «1»1, during = «1»fails(), after = «0»3;
} catch {}
{
  «1»label: «1»for (let i = «1»0; i < 2; i++) «2»continue label;
}
«1»for (const item of [1, 2]) «2»item, item;
«1»for (unset = 0; unset; ) «0»one;
«1»if (one);
const arrow = «1»() => «0»one;
«1»class Made { field = «2»1; static shared = «1»2; bare; static { «1»one; } }
«1»new Made(), new Made();
«1»class NeverMade { field = «0»1; #hidden = «0»2; accessor kept = «0»3; }
const Unnamed = «1»class { field = «0»1; static both = («1»one, two); };
{ const min = «1»Math.min, max = «1»Math.max, abs = «1»Math.abs; }
«1»enum Color { Red }
«1»namespace Space.Inner { export const value = «1»1; }
declare namespace Ambient { const value: 1; }
async function stuck() { «1»await new Promise(() => {}); «0»one; }
«1»stuck();
function* generator() { «1»yield 1; «0»yield 2; }
«1»generator().next();
export { one };
export * from "./hints.js";
«1»export default { two };
`,
  "common.cjs": `
"use strict";
var hoisted;
«1»exports.first = 1;
«1»module.exports.second = function () { «0»return 2; };
«1»Object.defineProperty(exports, "third", { enumerable: true, get: function () { «1»return 3; } });
«1»if (typeof module === "undefined") { «0»exports.browser = true; }
{ var inBlock = «1»1, unset; function inBlockToo() { «0»return 4; } }
«1»if (exports.first) «1»return;
«0»exports.last = 5;
`,
  // No statement is next to them.
  "const-enum.ts": `
«1»const enum Alone { A }
`,
  "export-enum.ts": `
«1»export enum Alone { A }
`,
  "export-namespace.ts": `
«1»export namespace Alone { export let a; }
`,
  "export.cts": `
«1»export = {};
`,
  "decorated.ts": `
«1»@Object export default class {}
`,
  "default.ts": `
interface Type {}
export default Type;
«1»Object();
`,
  "empty.cjs": `
`,
  "sloppy.cjs": `
«1»try { «1»with (null) «0»exports; } catch {}
«1»for (var key = «1»1 in {}) «0»key;
«1»module;
`,
  // The transpiler or JavaScriptCore has no code for them, or moves them.
  "dropped.ts": `
const L = «1»1;
function unused() {
  «1»L;
  «1»"text";
  «1»undefined;
  «1»[];
  «1»() => { «0»return L; };
  «1»if (false) { «0»unused(); }
  «1»while (false) «0»unused();
  «1»return;
  «0»unused();
}
«1»unused();
function disposes() {
  using none = «1»null;
  using more = «1»null;
  «1»for (using item of [null]) «1»item;
  «1»switch (L) { case 1: { using inner = «1»null; «1»break; } }
}
«1»disposes();
«1»const enum Inlined { A = 1 }
export const value = «1»Inlined.A;
import common = require("./common.cjs");
«1»common;
`,
  "hints.js": `
/* istanbul ignore next */
function whole() {
  return 1;
}
const object = «1»{
  /* istanbul ignore next */
  method() { return 1; },
  /* istanbul ignore next */
  property: () => 1,
  kept() { «0»return 1; },
};
«1»class Members {
  /* istanbul ignore next */
  field = 1;
  /* istanbul ignore next */
  method() { return 1; }
}
«1»try {
  «1»object;
} /* istanbul ignore next */ catch {
  object;
}
«1»try {
  «1»object;
} catch (error) /* istanbul ignore next */ {
  object;
}
/* c8 ignore next */
function firstLine() {
  «0»return 1;
}
/* c8 ignore next */
object;
function body() /* istanbul ignore next */ { return 1; }
«1»class Bodies { constructor() /* istanbul ignore next */ { object; } }
const first = «1»1, /* istanbul ignore next */ second = 2;
/* istanbul ignore next */
export const exported = () => 1;
`,
};

/** `?` is `(anonymous_0)` and so on. */
export const functions: Record<string, string> = {
  "functions.ts": `
function declared() «declared 2»{}
declared(), declared();
function outer() «outer 0»{ function inner() «inner 0»{ return () => «? 0»{}; } }
const arrow = () => «arrow 0»{}, expression = function () «expression 0»{}, named = function own() «own 0»{};
let assigned; assigned = () => «assigned 0»{}; assigned ||= () => «assigned (2) 0»{};
const { pattern = () => «pattern 0»{} } = {} as any;
const cast = (() => «cast 0»{}) as any;
const object = { method() «object.method 1»{}, get a() «get object.a 0»{ return 1; }, set a(v) «set object.a 0»{}, property: () => «object.property 0»{}, ["com" + "puted"]() «? 0»{}, "a, b"() «object.a_ b 0»{}, async *generator() «object.generator 0»{} };
object.method();
Object({ "a\\nb"() «a_b 0»{} });
Object({ "c\\u0085\\u2028\\u2029\\ud800\\xe9"() «c____é 0»{} });
class Shape { constructor() «Shape.constructor 1»{} area() «Shape.area 1»{} static of() «Shape.of 0»{} #hidden() «Shape.#hidden 0»{} get size() «get Shape.size 0»{ return 1; } field = () => «Shape.field 0»{}; static {} }
const Unnamed = class { area() «Unnamed.area 0»{} };
new Shape().area();
function Old() «Old 0»{}
Old.prototype.area = function () «Old.area 0»{};
Old.of = function () «Old.of 0»{};
{ function same() «same 0»{} }
{ function same() «same (2) 0»{} }
[1].map(() => «? 1»{});
function overloaded(a: string): void;
function overloaded(a: any) «overloaded 0»{}
abstract class Abstract { abstract area(): void; }
declare function ambient(): void;
function* notResumed() «notResumed 0»{}
notResumed();
function throwsInParameters(a = (null as any).b) «throwsInParameters 0»{}
try { throwsInParameters(); } catch {}
enum Color { Red }
namespace Space { export const value = 1; }
typeof function dropped() «dropped 0»{};
[assigned = () => «assigned (3) 0»{}] = [];
export default function () «default 0»{}
`,
  "function-hints.js": `
/* c8 ignore next */
function onLine() {}
export /* istanbul ignore next */ function afterExport() {}
export /* istanbul ignore next */ class AfterExport { method() {} }
function body() /* istanbul ignore next */ «body 0»{}
`,
  // They are not the function around CommonJS.
  "parameters.mjs": `
(function (exports, module) «? 0»{});
`,
  "followed.mjs": `
(function (exports, require, module) «? 0»{});
(function () «? 1»{})();
`,
};

/** At the end of each line that `lcov.info` lists. */
export const lines: Record<string, string> = {
  "lines.ts": `
export
async function«1»
split() {}«1»
split();«1»
const Class =«1»
  class {«1»
    static field«1»
      = 1;«1»
  };
new Class(«1»
);«1»
enum Color {«1»
  Red,«1»
}
abstract class Types {«1»
  [key: string]: unknown;
  [Symbol.iterator](): void;
  [Symbol.iterator]() {}«1»
  declare a: number;
  abstract b: number;
}
Object(«1»
  0 || 1,«1»
);«1»
for («1»
  let i = 0;«1»
  i <«1»
  0;«1»
  i++«0»
) split();«0»
do {«1»
} while (
  0«1»
);
try {«1»
  (null as any).a;«1»
  let unset;«0»
  {
    unset;«0»
  }
  let last;«0»
} catch {}«1»
`,
  "lines.js": `
"use strict";«1»
Object({«1»
  get a() {},«0»
  set a(v) {},«0»
});«1»
Object([«1»
  ,
]);«1»
try {«1»
} finally {«1»
}
let i = 0;«1»
while (i < 2)«3»
  i++;«2»
do i--;«2»
while (i);«2»
for (; i < 2; i++);«3»
for (;;) break;«1»
while (true) if (!i--) break;«3»
null«1»
  ?.a;«0»
i ||=«1»
  0;«0»
(«1»
  i«1»
) ||= 0;«0»
function defaults(«1»
  {«1»
    a,«1»
  } = {},«0»
  [«1»
    b,«1»
  ] = [],«0»
) {}
defaults({}, []);«1»
try {«1»
  («1»
    null.a«1»
  ) ? 1 : 2;«0»
} catch {}«1»
const unused =«1»
  () => 1;«0»
Object([{ a: new Object(Object ||«1»
  1) }]);«0»
[i =«1»
  1] = [i];«1»
class Fields { m() {«1»
  i; } a;«0»
  b; }«1»
null«1»
  // istanbul ignore next
  ?.a;
try {«1»
} catch {
  // istanbul ignore next
}
`,
  "alone.js": `
let unset;«1»
`,
  "types.tsx": `
Object<«1»
  string
>(1);«1»
`,
  "text.jsx": `
/** @jsxRuntime classic */
/** @jsx Object */
<p>«1»
  text«1»
  <b />«1»
</p>;«1»
`,
};

/** What `bun build` writes in another way, or leaves out. */
export const bundled: Record<string, string> = {
  "statements/exports.cjs": `«1»exports.one = function () { «4»return Object; };`,
  "statements/rewritten.js": `
    import { one } from "./exports.cjs";
    const unused = «1»[];
    const flipped = «1»c => «1»"a" == c;
    «1»flipped();
    const curried = «1»() => «1»c => «0»"a" == c;
    «1»curried();
    function operand() { «1»Object(); const a = «1»one(); «1»return typeof a; }
    function right() { «1»Object(); const a = «1»one(); «1»return "" + a; }
    function callee() { «1»Object(); const A = «1»one(); «1»return new A(); }
    function parenthesized(b) { «1»Object(); const a = «1»b = one(); «1»return "" + a; }
    function base() { const a = «1»1; const none = «1»null; «1»return class extends none {}; }
    async function awaited() { «1»Object(); const a = «1»Object(); «1»return await a; }
    «1»try { «1»Object.none(); «0»Object(); } catch {}
    «1»operand(), right(), callee(), parenthesized(), base(), awaited();
    const last = «1»typeof one;`,
  "statements/inlined.js": `
    function arm(v) { const a = «1»1; «1»return v ? a : 2; }
    function assigned(v) { const a = «1»1; «1»while (v) «0»v = a; }
    function tested(v) { const a = «1»1; const b = «1»2; «1»switch (v) { case a: case b: case 3: } }
    «1»arm(), assigned(), tested();`,
  "branches/folded.js": `
    const all = (v, w) => [[1 ? 1 : 2], v[1 ? "a-b" : "c"], v.apply(v, 1 ? [] : 0), (w += 1 ? v + "!" : 0)];
    switch (all(Object)) { «0»case 1 ? 1 : 0: «0»case 2: «0»case 3: Object(); }`,
  "branches/flipped.js": `«0»«1»if («1»Object.none && "object" == typeof Object) Object();`,
  "branches/member.js": `import * as all from "../statements/exports.cjs";\nglobalThis.member = «1»Object.none ?? «1»all.one;`,
  "statements/after-declaration.js": `const kept = «1»Object();\nconst dropped = «1»1;`,
  // Nothing says whether control gets there.
  "statements/after-if.js": `«1»if (Object.none) «0»throw 1;\nconst dropped = 1;`,
  "lines/directive.js": `"use strict";«1»\nObject();«1»\n`,
  "functions/accessor.js": `({ set a(v) «set a 1»{} }).a = 1;`,
};

export const statementsWithExperimentalDecorators = `
const mark = «1»(...made: any[]) => «6»(...marked: any[]) => { «6»made; };
«1»@mark(() => «0»1)
export class Made {
  @mark(() => «0»2) marked = «2»3;
  plain = «2»4;
  static shared = «1»5;
  @mark() static markedShared = «1»6;
  [mark.name] = «2»7;
  constructor(@mark(() => «0»8) public given = 9) { «2»this.plain; }
  @mark() method(@mark(() => «0»10) value: number) { «0»return value; }
}
«1»class Derived extends Made {
  own = «1»11;
  constructor() { «1»mark; «1»super(); «1»mark; }
}
«1»new Made(), new Derived();
«1»export class NeverMade { plain = «0»12; }
«1»class Fails { plain = «1»(null as any).a; constructor() { «0»mark; } }
«1»try { «1»new Fails(); } catch {}
`;
