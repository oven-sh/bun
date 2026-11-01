// Corpus for bundler_bytecode_portable.test.ts, organized by what JavaScriptCore's bytecode cache serializes
// (runtime/CachedTypes.cpp): one section per record type, each with the variations of source that change what that
// record holds. Output must not depend on time, randomness or the host.
var out = [];
function emit(label, ...xs) {
  out.push(label + ": " + xs.map(x => (typeof x === "bigint" ? x + "n" : typeof x === "symbol" ? x.toString() : typeof x === "function" ? "fn:" + x.name : (JSON.stringify(x) ?? String(x)))).join(" "));
}

// -- CachedUniquedStringImpl / CachedIdentifier / CachedString -----------------------------------------------------
// Identifiers and string constants: 1-3 character Latin-1 (stored in the reference itself), longer Latin-1, 16-bit,
// astral (surrogate pairs), empty, >= 48 characters (aliases the payload when decoded), the same characters as both an
// identifier and a constant (one record, two references), private names (#x: registered private symbols), and
// property names that are numbers.
function strings() {
  const a = "a", ab = "ab", abc = "abc", abcd = "abcd", empty = "";
  const é = "é", ĀƁ = "ĀƁ", 日本 = "日本語テキスト", 𝒳 = "𝒳𝒴𝒵 astral", mixed = "abc日本", nul = "a\0b", nl = "line1\nline2\ttab";
  const long48 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV"; // exactly 48
  const long47 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTU";
  const long16 = "長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長い長";
  const o = { a, ab, abc, abcd, é, ĀƁ, 日本, 𝒳, 0: "zero", 1.5: "one point five", [-1]: "neg", "with space": 1, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV": long48 };
  const sameAsIdentifier = ["strings", "emit", "out", "長い"];
  class P { #a = 1; #ab = 2; #abcd = 4; #日本 = 5; static count(p) { return p.#a + p.#ab + p.#abcd + p.#日本; } }
  return [a + ab + abc + abcd + empty, é.length + ĀƁ.length + 日本.length + 𝒳.length + mixed.length + nul.length + nl.length, long48.length, long47.length, long16.length, Object.keys(o).length, o["with space"], o[0], o["1.5"], o[-1], sameAsIdentifier.join().length, P.count(new P())];
}
emit("strings", ...strings());

// -- CachedJSValue (constant registers) and SourceCodeRepresentation ------------------------------------------------
// Every kind a constant register can hold, and for numbers both the Integer and Double source representations. The
// NaNs are folded by the parser using the host's arithmetic (x86 and ARM disagree on the sign of 0 / 0); the constant
// must not carry that.
function constants() {
  const ints = [0, 1, -1, 42, 255, 256, 65535, 65536, 2147483647, -2147483648, 0x7f, 0o17, 0b1011, 1_000_000];
  const doubles = [0.5, -0.5, 1.0, 1e21, 1e-7, 2147483648, -2147483649, 4294967295, 9007199254740991, 9007199254740993, 1.7976931348623157e308, 5e-324, -0, 0.1 + 0.2, 3.141592653589793];
  const special = [1 / 0, -1 / 0, 0 / 0, -(0 / 0), 0 * (1 / 0), 1 / 0 - 1 / 0, (1 / 0) * 0, undefined, null, true, false];
  const strs = ["", "s", "st", "str", "string", "ストリング"];
  let u; // an uninitialized let reads the Undefined constant
  const viaVoid = void 0;
  return [ints.reduce((x, y) => x + y, 0), doubles.map(d => (Object.is(d, -0) ? "-0" : String(d))).join(","), special.map(String).join(","), strs.join("|"), u === viaVoid, typeof u];
}
emit("constants", ...constants());

// -- CachedImmutableButterfly (array literal constants) --------------------------------------------------------------
// Copy-on-write array literals by indexing type: Int32, Double, Contiguous (strings / mixed / nested), with holes,
// empty, single element, long.
function arrayLiterals() {
  const int32 = [1, 2, 3, 4, 5, 6, 7, 8];
  const oneInt = [7];
  const negInts = [-1, -2, -3];
  const doubles = [0.5, 1.5, 2.5];
  const mixedNum = [1, 2.5, 3];
  const withNegZero = [0, -0];
  const stringsArr = ["x", "yy", "zzz", "wwww"];
  const mixed = [1, "two", 3.5, true, null, undefined];
  const nested = [[1, 2], [3.5], ["s"], []];
  const holes = [1, , 3, , , 6];
  const leadingHole = [, 1];
  const trailingComma = [1, 2, 3,];
  const emptyArr = [];
  const big = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64];
  const bigDoubles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5];
  const withSpread = [...int32, ...doubles];
  const withExpr = [1, int32.length, 3];
  return [int32.length + oneInt[0] + negInts[2], doubles[1], mixedNum[1], Object.is(withNegZero[1], -0), stringsArr.join(""), mixed.map(x => typeof x).join(), nested.flat().length, holes.length, 1 in holes, leadingHole.length, trailingComma.length, emptyArr.length, big[64], bigDoubles.length, withSpread.length, withExpr[1]];
}
emit("arrays", ...arrayLiterals());

// -- CachedRegExp --------------------------------------------------------------------------------------------------------
function regexps() {
  const res = [/x/, /x/g, /x/i, /x/m, /x/s, /x/u, /x/y, /x/d, /x/v, /x/dgimsy, /^\s*$/, /(a)(?:b)(?<n>c)\1\k<n>/, /[^\]\\/-]+/, /\u{1F600}/u, /日本+/u, /a{2,3}?|b*?|c+?/, /(?=a)(?!b)(?<=c)(?<!d)/, /\p{Script=Greek}/u, /[\p{L}--[a-z]]/v, /./];
  const same1 = /dup/g, same2 = /dup/g; // two objects, one pattern string
  const subjects = ["x", "X", " ", "abcac", "a/b", "😀", "日本本", "aab", "cab", "λ", "k", "\n"];
  return [res.map(r => r.flags).join("|"), res.map(r => subjects.findIndex(t => r.test(t))).join(","), same1 !== same2, "xx".replace(res[1], "y"), res[11].exec("abcac")?.groups.n];
}
emit("regexps", ...regexps());

// -- CachedTemplateObjectDescriptor (raw strings, cooked strings, absent cooked strings) ----------------------------
function templates() {
  const tag = (s, ...v) => [s.length, s.every(c => c !== undefined && /^[ -~]*$/.test(c)) ? s.raw.join("|") : s.raw.length, s.map(c => (c === undefined ? "U" : c)).join("|"), v.length];
  const t1 = tag``;
  const t2 = tag`one`;
  const t3 = tag`a${1}b${2}c${3}d`;
  const t4 = tag`\n\t\\${0}\x41B\u{43}`; // raw and cooked differ
  const t5 = tag`\unicode and \xyz`; // invalid escapes: cooked is undefined
  const t6 = tag`日本${"語"}テキスト`;
  const t7 = tag`${1}${2}${3}`; // empty strings between substitutions
  const t8 = tag`
multi
line`;
  const again = () => tag`one`; // same site contents as t2, distinct site
  const cached = [1, 2].map(() => tag`per-site`); // one site evaluated twice: same template object
  return [t1, t2, t3, t4, t5, t6, t7, t8, again()[1], cached[0][1] === cached[1][1]];
}
emit("templates", ...templates());

// -- CachedBigInt --------------------------------------------------------------------------------------------------------
function bigints() {
  const b = [0n, 1n, -1n, 127n, 128n, 255n, 256n, 65535n, 4294967295n, 4294967296n, 18446744073709551615n, 18446744073709551616n, -18446744073709551616n, 0x1fn, 0o17n, 0b101n, 1_000_000n, 123456789012345678901234567890123456789012345678901234567890n];
  return [b.map(String).join(","), b.reduce((x, y) => x + y, 0n), (2n ** 200n).toString().length];
}
emit("bigints", ...bigints());

// -- CachedSimpleJumpTable / CachedStringJumpTable --------------------------------------------------------------------
// Immediate switches (dense, offset from zero, negative, sparse -> not a table), character switches (single-character
// string cases), string switches (multi-character cases, varying lengths), mixed (falls back), nested, fallthrough.
function switches(v, s, c) {
  let r = "";
  switch (v) { case 0: r += "a"; break; case 1: r += "b"; break; case 2: r += "c"; break; case 3: r += "d"; break; default: r += "-"; }
  switch (v) { case 10: r += "a"; break; case 11: r += "b"; break; case 12: r += "c"; break; case 13: r += "d"; break; default: r += "-"; }
  switch (v) { case -2: r += "a"; break; case -1: r += "b"; break; case 0: r += "c"; break; case 1: r += "d"; break; default: r += "-"; }
  switch (v) { case 1: r += "a"; break; case 100: r += "b"; break; case 10000: r += "c"; break; case 1000000: r += "d"; break; default: r += "-"; }
  switch (v) { case 1: case 2: case 3: r += "x"; case 4: r += "y"; break; case 5: r += "z"; }
  switch (c) { case "a": r += 1; break; case "b": r += 2; break; case "c": r += 3; break; case "z": r += 26; break; case "é": r += 27; break; case "日": r += 28; break; default: r += 0; }
  switch (s) { case "alpha": r += "A"; break; case "beta": r += "B"; break; case "gamma": r += "G"; break; case "delta": r += "D"; break; case "epsilon": r += "E"; break; case "日本語": r += "J"; break; default: r += "?"; }
  switch (s) { case "aa": r += 1; break; case "bbbb": r += 2; break; case "cccccccc": r += 3; break; case "dddddddddddddddd": r += 4; break; default: r += 5; }
  switch (s) { case 1: r += "n"; break; case "beta": r += "s"; break; case null: r += "0"; break; default: r += "m"; }
  switch (v) {
    case 1:
      switch (s) { case "beta": r += "nb"; break; case "zeta": r += "nz"; break; case "eta": r += "ne"; break; }
      break;
    case 2: r += "n2"; break;
    case 3: r += "n3"; break;
  }
  return r;
}
emit("switches", switches(1, "beta", "b"), switches(12, "dddddddddddddddd", "日"), switches(-1, "nope", "?"), switches(1000000, "日本語", "é"));

// -- CachedHandlerInfo (exception handler table: Catch, Finally, SynthesizedCatch, SynthesizedFinally) ---------------
function handlers() {
  const log = [];
  try { log.push("t1"); } catch { log.push("c1"); }
  try { throw 1; } catch (e) { log.push("c2:" + e); }
  try { log.push("t3"); } finally { log.push("f3"); }
  try { throw 2; } catch ({ message = "d" }) { log.push("c4:" + message); } finally { log.push("f4"); }
  try { try { throw 3; } finally { log.push("f5"); } } catch (e) { log.push("c5:" + e); }
  outer: for (const i of [1, 2, 3]) { // for-of: synthesized finally closes the iterator
    try {
      if (i === 1) continue outer;
      if (i === 3) break outer;
      log.push("i" + i);
    } finally {
      log.push("fi" + i);
    }
  }
  const f = () => { try { return "r"; } finally { log.push("fr"); } };
  log.push(f());
  function* g() { try { yield 1; yield 2; } finally { log.push("fg"); } }
  for (const x of g()) { if (x === 1) break; }
  const [d1, ...dRest] = new Set([1, 2, 3]); // array destructuring closes the iterator too
  log.push(d1 + dRest.length);
  try { try { throw new Error("inner"); } catch (e) { throw new TypeError(e.message + "!"); } finally { log.push("ff"); } } catch (e) { log.push(e.constructor.name + ":" + e.message); }
  return log;
}
emit("handlers", ...handlers());

// -- CachedBitVector (spread positions) and CachedHashSet (identifier sets for object rest) ----------------------------
function spreadsAndRest() {
  const a = [1, 2], b = [3], c = [4, 5, 6];
  const f = (...xs) => xs.length;
  const calls = [f(...a), f(0, ...a), f(...a, 0), f(0, ...a, 0, ...b, ...c, 0), f(...a, ...b, ...c), new Array(...c).length];
  const arrays = [[...a], [0, ...a], [...a, 0], [0, ...a, 0, ...b, ...c, 0], [...a, ...b, ...c], [...[...a, ...b]]].map(x => x.length);
  const o = { p: 1, q: 2, r: 3, s: 4, t: 5, 日: 6 };
  const { p, ...r1 } = o;
  const { p: pp, q, ...r2 } = o;
  const { 日, s, t, r, ...r3 } = o;
  const { ...all } = o;
  const { ["p"]: dyn, ...r4 } = o; // computed key: not a constant set
  const objs = [{ ...o }, { x: 0, ...o }, { ...o, x: 0 }, { ...o, ...r1 }].map(x => Object.keys(x).length);
  return [calls, arrays, Object.keys(r1).join(""), Object.keys(r2).join(""), Object.keys(r3).join(""), Object.keys(all).length, Object.keys(r4).length + dyn + pp + q + 日 + s + t + r + p, objs];
}
emit("spread/rest", ...spreadsAndRest());

// -- CachedSymbolTable / CachedScopedArgumentsTable / CachedSymbolTableEntry -----------------------------------------
// Scopes that become SymbolTable constants: closures over var/let/const (ReadOnly entries), a captured catch
// parameter, a named function expression that refers to itself, parameters captured with a sloppy `arguments`
// (ScopedArgumentsTable), default-parameter scopes, direct eval (usesSloppyEval), class scopes with private names
// (SymbolTableRareData), many captured variables.
function scopes() {
  var v = 1; let l = 2; const k = 3;
  const closure = () => v + l + k;
  let caught;
  try { throw 10; } catch (e) { caught = () => e; }
  const named = function self(n) { return n ? self(n - 1) + 1 : 0; };
  function sloppyArgs(a, b) { const g = () => a + b; arguments[0] = 100; return g() + arguments.length; }
  function defaults(a = 1, b = () => a + c, c = 3) { var a2 = a; return b() + a2; }
  function withEval(x) { var y = 2; return eval("x + y"); }
  function many() {
    let v0 = 0, v1 = 1, v2 = 2, v3 = 3, v4 = 4, v5 = 5, v6 = 6, v7 = 7, v8 = 8, v9 = 9, v10 = 10, v11 = 11, v12 = 12, v13 = 13, v14 = 14, v15 = 15, v16 = 16, v17 = 17, v18 = 18, v19 = 19;
    return () => v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11 + v12 + v13 + v14 + v15 + v16 + v17 + v18 + v19;
  }
  class WithPrivate {
    #f = 1; #g() { return 2; } get #h() { return 3; } set #h(x) {} static #s = 4; static #t() { return 5; }
    sum() { return this.#f + this.#g() + this.#h + WithPrivate.#s + WithPrivate.#t(); }
  }
  function nestedScopes() {
    let a = 1;
    { let b = 2; { let c = 3; { let d = 4; return () => a + b + c + d; } } }
  }
  function loopClosures() { const fs = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) fs.push(() => i * 10 + j); return fs.map(f => f()).join(); }
  function blockFn() { { function inBlock() { return "ib"; } return inBlock(); } }
  return [closure(), caught(), named(3), sloppyArgs(1, 2), defaults(), withEval(1), many()(), new WithPrivate().sum(), nestedScopes()(), loopClosures(), blockFn()];
}
emit("scopes", ...scopes());

// -- CachedCompactTDZEnvironment / CachedTDZEnvironmentLink (parent TDZ chains of nested functions) ----------------
function tdzChains() {
  const r = [];
  let a = 1;
  function f1() {
    let b = 2;
    class C1 { static v = 3; }
    function f2() {
      const c = 4;
      const f3 = () => {
        let d = 5;
        return function f4() { class C2 extends C1 { static w = C1.v + d; } return () => a + b + c + C2.w; };
      };
      return f3;
    }
    return f2;
  }
  r.push(f1()()()()());
  { let x = 1; const g = () => x; const h = () => x + 1; r.push(g() + h()); } // siblings share one environment
  { let x = 2; { const g = () => x; r.push(g()); } }
  switch (r.length) { case 3: let inCase = 7; r.push((() => inCase)()); }
  for (const q of [8]) r.push((() => q)());
  return r;
}
emit("tdz", ...tdzChains());

// -- CachedFunctionExecutable: every parse mode, naming form, parameter shape, and source-position shape -------------
const anon = [function () {}, () => {}, async () => {}, function* () {}, async function* () {}, class {}];
const inferred = { prop: function () {}, arrowProp: () => {}, ["comp" + "uted"]: () => {}, 1: () => {}, [Symbol.for("sym")]: () => {} };
const named = function explicit() {};
let assigned; assigned = function () {};
const dflt = { f(a, b = a, [c, d] = [1, 2], { e, f: { g } = { g: 3 } } = { e: 4 }, ...h) { return [a, b, c, d, e, g, h.length]; } };
function oneLiner() { return 1; } function sameLine() { return 2; }
function
  oddlySplit
  (
    a,
    b
  )
  {
    return a + b;
  }
const 日本語関数 = (引数) => 引数 * 2; /* multi-byte before */ const afterWide = () => "col";
class Modes {
  constructor() { this.v = 1; }
  method() { return 2; }
  get getter() { return 3; }
  set setter(x) { this.v = x; }
  static staticMethod() { return 4; }
  static get staticGetter() { return 5; }
  static set staticSetter(x) {}
  *gen() { yield 6; }
  async asyncMethod() { return 7; }
  async *asyncGen() { yield 8; }
  static { Modes.fromStaticBlock = 9; }
  field = 10;
  static staticField = 11;
  #p() { return 12; }
  get #pg() { return 13; }
  static async #sap() { return 14; }
  arrowField = () => this.v;
  ["computed"]() { return 15; }
  static async *["computedAsyncGen"]() {}
  probe() { return this.#p() + this.#pg; }
}
class DerivedModes extends Modes {
  constructor() { const pre = () => new.target.name; super(); this.pre = pre(); }
  method() { return super.method() + (() => super.method())(); }
  static staticMethod() { return super.staticMethod(); }
  field = (() => super.method())();
}
function functionShapes() {
  const params = [function () {}, function (a) {}, function (a, b, c, d, e, f, g, h) {}, function (...r) {}, function (a, b = 1) {}, function ({ a }, [b]) {}].map(f => f.length);
  const dm = new DerivedModes();
  return [anon.map(f => f.name).join("|"), Object.values(inferred).map(f => f.name).join("|"), inferred[Symbol.for("sym")].name, named.name === "explicit" || named.name.length === 1, assigned.name, dflt.f(9), params, oneLiner() + sameLine() + oddlySplit(1, 2), 日本語関数(2), afterWide(), Modes.fromStaticBlock, new Modes().probe(), dm.pre, dm.method(), DerivedModes.staticMethod(), dm.field, dm.arrowField(), [...new Modes().gen()][0]];
}
emit("functions", ...functionShapes());

// -- CachedFunctionExecutableRareData / CachedClassElementDefinition ---------------------------------------------------
// Class field definitions of every kind (with and without initializer, computed, private, static, quoted, numeric), the class
// source kept for constructors, generator/async wrapper parameter names, a parent private-name environment.
class Elements {
  a; b = 1; "quoted" = 2; 42 = 3; ["comp" + "A"]; ["comp" + "B"] = 4; #priv; #privInit = 5; static s; static t = 6; static ["compS"] = 7; static #ps = 8;
  #日本 = 11; 日本 = 12;
  static read(e) { return [e.a, e.b, e.quoted, e[42], e.compA, e.compB, e.#priv, e.#privInit, Elements.s, Elements.t, Elements.compS, Elements.#ps, e.#日本, e.日本]; }
}
class NoFields { m() {} }
class OnlyStatic { static x = 1; }
class CtorAndFields { f = 1; constructor(a) { this.a = a; } }
class DerivedFields extends CtorAndFields { g = 2; }
class DerivedFieldsCtor extends CtorAndFields { h = 3; constructor() { super(0); this.i = this.h + 1; } }
function* genWithParams(a, b = 2, ...c) { yield a + b + c.length; }
async function asyncWithParams(x, { y }, [z]) { return x + y + z; }
const asyncArrowWithParams = async (p, q) => p + q;
class Outer { #o = 1; inner() { const o = this; return class { probe() { return o.#o; } }; } static nested() { return () => () => class { #i = 2; get() { return this.#i; } }; } }
function rareData() {
  return [Elements.read(new Elements()).map(x => x ?? "U").join(), typeof new NoFields().m, OnlyStatic.x, new DerivedFields(5).a + new DerivedFields(5).g, new DerivedFieldsCtor().i, genWithParams(1).next().value, asyncArrowWithParams.length, new (new Outer().inner())().probe(), new (Outer.nested()()())().get(), CtorAndFields.toString().startsWith("class"), Elements.name];
}
emit("rareData", ...rareData());

// -- Object literals: every property definition opcode -------------------------------------------------------------------
function objectLiterals(k) {
  const v = 1;
  const objs = [
    {}, { v }, { v, k }, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }, { "quoted key": 1, 2: "numeric", 3.5: "double", [-4]: "neg" },
    { [k]: 1, [k + 2]: 2, [Symbol.toPrimitive]: () => 7 }, { get a() { return 1; } }, { set a(x) {} }, { get a() { return 1; }, set a(x) {} },
    { get [k]() { return 2; }, set [k](x) {} }, { method() {}, *gen() {}, async am() {}, async *ag() {}, [k]() {} }, { __proto__: null, own: 1 }, { __proto__: Array.prototype }, { "__proto__": 1 }.constructor === Object ? { ["__proto__"]: 2 } : null,
    { ...{ x: 1 }, y: 2, ...null, ...undefined, ...[3] }, { toString() { return "ts"; } }, { a: { b: { c: { d: {} } } } },
  ];
  return [objs.map(o => (o ? Object.getOwnPropertyNames(o).length + Object.getOwnPropertySymbols(o).length : -1)).join(","), +objs[5], String(objs[16]), Object.getPrototypeOf(objs[11]), objs[13].__proto__];
}
emit("objects", ...objectLiterals("kk"));

// -- Control flow and operators not covered above ------------------------------------------------------------------------
function controlFlow(n) {
  const r = [];
  a: { b: { if (n) break a; r.push("b"); } r.push("a"); }
  let i = 0; w: while (true) { i++; if (i > 5) break w; if (i % 2) continue w; r.push(i); }
  do { i--; } while (i > 3);
  for (;;) { if (--i < 0) break; }
  for (let j = 0, k = 10; j < k; j += 3, k -= 3) r.push(j * k);
  for (const ch of "ab") r.push(ch);
  for (const [key, val] of new Map([[1, "m"]])) r.push(key + val);
  for (var p in { x: 1, y: 2 }) r.push(p);
  for (const idx in [7, 8]) r.push(idx);
  const o = { deep: { fn: () => "called", arr: [() => "idx"] } };
  r.push(o?.deep?.fn?.(), o.deep.arr?.[0]?.(), o?.missing?.fn?.(), o.deep?.["fn"]?.());
  let la = null, lb = 0, lc = 1; la ??= "d"; lb ||= "e"; lc &&= "f"; o.deep.x ??= 1; o.deep["y"] ||= 2; r.push(la, lb, lc, o.deep.x + o.deep.y);
  r.push(n ? "t" : "f", n || "or", n && "and", n ?? "nn", !n, !!n, typeof undeclaredGlobal, typeof globalThis.undeclaredGlobal?.x);
  r.push("x" in o, 1 in [1, 2], o instanceof Object, [] instanceof Array, delete o.deep.x, delete o[n], delete o?.deep?.arr, (r.length, "comma"), void r, +"3", -"-4", ~~7.9);
  r.push(`t${n}e${n + 1}m${`nested${n}`}p`, String.raw`r\n${n}`);
  if (n === 0) { } else if (n === 1) { r.push("elif"); } else { r.push("else"); }
  r.push(new.target === undefined, (() => new.target)());
  debugger;
  return r;
}
emit("control", ...controlFlow(0), "|", ...controlFlow(1));

// -- Generators / async: every suspend and resume form ------------------------------------------------------------------
function* everyYield() { const x = yield 1; yield* [2, 3]; yield* inner(); try { yield 4; } finally { yield 5; } return x; function* inner() { yield "i"; } }
async function everyAwait() { const a = await 1; const b = await Promise.resolve(2); let c = 0; for await (const v of (async function* () { yield 3; yield 4; })()) c += v; try { await Promise.reject(new Error("no")); } catch (e) { c += e.message.length; } return a + b + c; }
async function* asyncGenForms() { yield 1; yield await 2; yield* [3]; yield* (async function* () { yield 4; })(); return 5; }
const arrowAsync = async x => (await x) + 1;
class AsyncMethods { async m() { return 1; } async *g() { yield 2; } static async s() { return 3; } }
function drive() {
  const g = everyYield(); const ys = []; let step = g.next(); while (!step.done) { ys.push(step.value); step = g.next("sent"); } ys.push(step.value);
  return ys;
}
emit("generators", ...drive());

// -- ExpressionInfo: divots/line/column deltas large enough for the wide encodings ---------------------------------------
function expressionInfo() {
  const r = [];
  // a very long line, so column deltas need the extended encoding
  r.push([1, 2, 3].map(x => x * 2).filter(x => x > 2).reduce((a, b) => a + b, 0) + [4, 5, 6].map(x => x * 3).filter(x => x > 12).reduce((a, b) => a + b, 0) + [7, 8, 9].map(x => x * 4).filter(x => x > 30).reduce((a, b) => a + b, 0) + "a".repeat(3).length + "b".repeat(4).length + "c".repeat(5).length + Math.max(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20) + Math.min(21, 22, 23, 24, 25, 26, 27, 28, 29, 30) + [31, 32, 33, 34, 35, 36, 37, 38, 39, 40].indexOf(35) + "the quick brown fox jumps over the lazy dog".split(" ").map(w => w.length).join("").length);




















  // twenty blank lines later: a line delta that does not fit the small encoding either
  r.push(r[0] + 1);
  return r;
}
emit("expressionInfo", ...expressionInfo());

// -- Sloppy-mode-only forms (this file is a script): with, callee, function-in-if, labelled function, `arguments` var
function sloppyForms(dup) {
  var r = [dup];
  with ({ scoped: "w", r: null }) { var fromWith = scoped; }
  r.push(fromWith, typeof arguments.callee, arguments.length);
  if (true) function inIf() { return "inIf"; }
  r.push(typeof inIf);
  lbl: function labelled() {}
  r.push(typeof labelled);
  var arguments; r.push(typeof arguments);
  return r;
}
emit("sloppy", ...sloppyForms(2));

Promise.all([everyAwait(), arrowAsync(Promise.resolve(1)), new AsyncMethods().m(), AsyncMethods.s(), asyncWithParams(1, { y: 2 }, [3]), (async () => { const vs = []; for await (const v of asyncGenForms()) vs.push(v); for await (const v of new AsyncMethods().g()) vs.push(v); return vs.join(); })()]).then(results => {
  emit("async", ...results);
  console.log(out.join("\n"));
});
