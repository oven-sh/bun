// Corpus for bundler_bytecode_portable.test.ts. It is written to reach every kind of object the JSC bytecode cache
// serializes (jump tables, exception handlers, regexps, template objects, bigints, constant arrays, symbol tables,
// private-name and TDZ environments, class element definitions, scoped-arguments tables) and every family of opcode
// that carries metadata. Output must not depend on time, randomness or the host.
var log = [];
function record(...xs) {
  log.push(xs.map(x => (typeof x === "bigint" ? x + "n" : (JSON.stringify(x) ?? String(x)))).join(" "));
}

function classify(n, s) {
  let a;
  switch (n) {
    case 1:
      a = "one";
      break;
    case 2:
      a = "two";
      break;
    case 3:
      a = "three";
      break;
    case 4:
      a = "four";
      break;
    default:
      a = "many";
  }
  switch (s) {
    case "alpha":
      return a + ":a";
    case "beta":
      return a + ":b";
    case "gamma":
      return a + ":g";
    case "delta":
      return a + ":d";
    default:
      return a + ":?";
  }
}

function literals() {
  const doubles = [1.5, 2.25, -0.5, 1e21];
  const mixed = ["x", 7, null, true];
  const ints = [1, 2, 3, 4, 5];
  const re = /(\d+)-(\w+)/gu;
  const big = 12345678901234567890123n * -3n;
  const tag = (s, ...v) => s.raw.join("|") + "#" + v.join(",");
  let caught;
  try {
    null.x;
  } catch (e) {
    caught = e.constructor.name;
  } finally {
    record("finally");
  }
  return [doubles, mixed, ints, "2020-ab".replace(re, "$2/$1"), big, tag`a${1}b${2}c`, caught, `t${doubles.length}`];
}

class Base {
  constructor(x) {
    this.x = x;
  }
  describe() {
    return "Base(" + this.x + ")";
  }
  static make(x) {
    return new this(x);
  }
}

class Derived extends Base {
  #secret = 41;
  static #count = 0;
  static tally;
  static {
    Derived.tally = () => Derived.#count;
  }
  publicField = this.#secret + 1;
  constructor(x, y) {
    super(x);
    this.y = y;
    Derived.#count++;
  }
  get #hidden() {
    return this.#secret * 2;
  }
  #bump() {
    return ++this.#secret;
  }
  static isDerived(o) {
    return #secret in o;
  }
  describe() {
    return `Derived(${super.describe()}, ${this.y}, ${this.#hidden}, ${this.#bump()})`;
  }
}

function* range(n, { step = 1 } = {}) {
  for (let i = 0; i < n; i += step) yield i;
}

async function* agen() {
  yield* [Promise.resolve("p1"), "p2"];
}

async function asyncStuff(a = 1, ...rest) {
  const seen = [];
  for await (const v of agen()) seen.push(v);
  for (const [i, v] of [...range(6, { step: 2 })].entries()) seen.push(i * v);
  const obj = {
    p: 1,
    q: 2,
    get r() {
      return 3;
    },
    ["s" + a]: 4,
  };
  for (const k in obj) seen.push(k);
  const { p, ...others } = obj;
  label: for (const x of range(3)) {
    for (const y of range(3)) {
      if (y > x) continue label;
      seen.push(`${x}${y}`);
    }
  }
  function usesArguments() {
    return arguments.length + (arguments[0] ?? 0);
  }
  seen.push(usesArguments(5, 6), p, Object.keys(others).length, rest.length, typeof new.target);
  return seen;
}

function tdz() {
  const fns = [];
  for (let i = 0; i < 3; i++) {
    let captured = i * 10;
    fns.push(() => captured + i);
  }
  {
    class Inner {
      static v = 1;
    }
    fns.push(() => Inner.v);
  }
  return fns.map(f => f());
}

function sloppy() {
  var o = { a: { b: null } };
  return [o?.a?.b?.c ?? "dflt", 2 ** 10, delete o.a, "a" in o, o instanceof Object, typeof o.zz, void 0, (1, 2)];
}


// Every operator the generator has an opcode (or a fused compare-and-jump) for.
function operators(a, b, u) {
  "use strict";
  const arith = [a - b, a / b, a % b, a ** b, -a, +u, ~a, a & b, a | b, a ^ b, a << b, a >> b, a >>> b, !a];
  let c = a;
  c--;
  --c;
  const rel = [a == b, a != b, u == null, u != null, a < b, a <= b, a > b, a >= b, a === b, a !== b];
  const jumps = [];
  if (a < b) jumps.push("jl");
  if (a <= b) jumps.push("jle");
  if (a > b) jumps.push("jg");
  if (a >= b) jumps.push("jge");
  if (a == b) jumps.push("jeq");
  if (a != b) jumps.push("jneq");
  if (u == null) jumps.push("jeqn");
  if (u != null) jumps.push("jneqn");
  if (a === b) jumps.push("jseq");
  if (a !== b) jumps.push("jnseq");
  if (!(a < b)) jumps.push("jnl");
  if (!(a <= b)) jumps.push("jnle");
  if (!(a > b)) jumps.push("jng");
  if (!(a >= b)) jumps.push("jnge");
  while (c > -2) c -= 3;
  do c++; while (c <= 0);
  const types = [typeof u === "function", typeof u === "object", typeof u === "undefined", typeof a === "number", typeof a === "boolean", typeof a === "bigint", typeof a === "string", typeof a === "symbol", u === undefined || u === null, Array.isArray(u)];
  return [arith, c, rel, jumps.join(","), types];
}

// Property access and definition forms: by-id / by-val / with-this / getters+setters / enumerator ops / delete.
function properties(key) {
  const sym = Symbol("s");
  const pair = { get both() { return this._b; }, set both(v) { this._b = v; } };
  pair.both = 8;
  const o = { plain: 1, [key]: 2, [sym]: 3, get g() { return this.plain; }, set s(v) { this.plain = v; }, get gs() { return 4; }, set gs(v) {}, [key + "fn"]: function () { return "anon"; }, method() { return super.toString !== undefined; } };
  o[key + "2"] = 5;
  o.s = 6;
  const arr = new Array(3);
  arr[0] = key;
  const seen = [];
  for (const k in o) {
    seen.push(k, o[k], k in o, o.hasOwnProperty(k));
    o[k] = o[k];
  }
  for (let k in o) {
    if (k === "plain") k = key; // reassigning the loop variable makes the loop body generic
    seen.push(typeof o[k]);
  }
  delete o[key];
  delete o.plain;
  o[key + "n"] = 0;
  o[key + "n"]++;
  o[key + "n"] += 1;
  class WithSuper extends Object {
    static probe(k) { return [super.name, super[k]]; }
    poke(k, v) { super.custom = v; super[k] = v; return [this.custom, this[k]]; }
  }
  return [pair.both, seen.length, Object.keys(o).length, arr.length, o[key + "fn"].name, o.method(), WithSuper.probe("length"), new WithSuper().poke("via", 7), typeof sym];
}

// Calls: varargs, tail calls, direct eval, .call/.apply fast paths, new.target, spread into super().
function calls() {
  "use strict";
  function sum(...xs) { return xs.reduce((x, y) => x + y, 0); }
  function tail(n, acc) { return n === 0 ? acc : tail(n - 1, acc + n); }
  function tailVar(...xs) { return sum(...xs); }
  class P { constructor(...xs) { this.n = xs.length; } }
  class Q extends P { constructor(...xs) { super(...xs); } }
  const args = [1, 2, 3];
  const viaEval = eval("args.length + 1");
  const indirect = (0, eval)("typeof args");
  return [sum(...args), tail(3, 0), tailVar(...args), new P(...args).n, new Q(...args, 4).n, sum.call(null, 1, 2), sum.apply(null, args), viaEval, indirect, Reflect.construct(P, args).n];
}

// A parameter read and written while an inner function captures `arguments`: DirectArguments (op_get_from_arguments/op_put_to_arguments).
function directArguments(p, q) {
  const later = () => arguments.length;
  p = "p2";
  return [p, q, arguments[0], later()];
}

// Sloppy-mode-only forms: with, arguments aliasing (ScopedArgumentsTable), callee, non-strict this.
function sloppyOnly(a, b) {
  var log = [];
  with ({ w: 1 }) {
    log.push(w);
  }
  arguments[0] = "aliased";
  log.push(a);
  b = "b2";
  log.push(arguments[1], arguments.length, typeof arguments.callee);
  function inner() { return typeof this; }
  log.push(inner(), ...directArguments("p", 2));
  var fromEval = eval("var hoisted = 3; function evalDecl() { return hoisted; } evalDecl()");
  log.push(fromEval, typeof evalDecl);
  return log;
}

// Function forms: expressions of every kind, name inference, default/destructured params, generators' internal ops.
const fnForms = {
  gen: function* (x = 1, { y } = { y: 2 }, [z] = [3]) { const sent = yield x + y + z; yield sent; },
  asyncFn: async function () { return await null; },
  asyncArrow: async () => 1,
  asyncGen: async function* () { yield 1; },
  arrow: () => fnForms,
  [Symbol.iterator]: function* () { yield* [1, 2]; },
};
class Accessors {
  static #priv() { return 1; }
  #instancePriv() { return 6; }
  static branded(o) { return #instancePriv in o ? o.#instancePriv() : -1; }
  static get [("dyn" + "Getter")]() { return 2; }
  static set [("dyn" + "Setter")](v) { Accessors.last = v; }
  static hasPriv(o) { try { return Accessors.#priv.call(o) === 1 && #priv in Accessors; } catch { return false; } }
  ["computed" + "Method"]() { return 3; }
  static [("computed" + "Field")] = 4;
  [("instance" + "Field")] = 5;
}
function functionForms() {
  const g = fnForms.gen();
  const first = g.next().value;
  const second = g.next("sent").value;
  Accessors.dynSetter = 9;
  return [first, second, fnForms.gen.name, fnForms.asyncFn.name, fnForms.arrow().asyncArrow.name, [...fnForms].length, Accessors.dynGetter, Accessors.last, Accessors.hasPriv(Accessors), new Accessors().computedMethod(), Accessors.computedField, new Accessors().instanceField, Accessors.branded(new Accessors()), Accessors.branded({})];
}

// Strings and other constants in every encoding the cache has: inline (<= 3 Latin-1), shared, 16-bit, long enough to
// alias the payload (>= 48), empty, well-known symbols, 0n, doubles/int32/holes in array literals, char switches.
function constants(ch) {
  const short = ["a", "ab", "abc", "", "abcd"];
  const wide = ["日本語", "😀 astral", "π", "abcā"];
  const long = "0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz";
  const wideLong = "長い文字列長い文字列長い文字列長い文字列長い文字列長い文字列長い文字列長い文字列長い文字列長い文字列";
  const ünïcödeIdentifier = 1;
  const holes = [1, , 3];
  const nested = [[1.5, 2.5], ["x", 1], [0n, -0, NaN, Infinity, 2 ** 31, -(2 ** 31) - 1, 1e-7]];
  const bigs = [0n, 1n, -1n, 2n ** 64n, BigInt.asUintN(64, -1n)];
  const res = [/a/, /a/dgimsuy, /(?<name>b)\k<name>/v, /[\p{L}--\p{Lu}]/v];
  let which;
  switch (ch) {
    case "a": which = 1; break;
    case "b": which = 2; break;
    case "c": which = 3; break;
    case "z": which = 26; break;
    default: which = -1;
  }
  const templ = ((s, ...v) => [s.length, s.raw[0], v.length])`x${1}é${wide[0]}y`;
  return [short.join("|"), wide.join("|").length, long.length, wideLong.length, ünïcödeIdentifier, holes.length, 1 in holes, nested.flat().length, bigs.map(String).join(","), res.map(r => r.flags).join(","), which, templ, Symbol.iterator in fnForms, `${long}${wideLong}`.length];
}
// Shapes whose register / scope-slot assignment once followed process state rather than the source: sloppy-mode
// block-level functions (Annex B.3.3 hoisting), a class scope with more than nine computed-key fields, an
// expression-bodied arrow whose last token spans lines. (No `number ** non-integer` literals anywhere in the corpus: the
// parser folds those through the host's pow(), so the constant may differ by the OS that built it.)
function orderSensitive(flag) {
  if (flag) { function first() { return 1; } function second() { return 2; } }
  else { function third() { return 3; } }
  { function fourth() { return typeof first + "/" + typeof third; } function fifth() {} function sixth() {} }
  class ManyComputed {
    ["a" + 1] = 1; ["b" + 2] = 2; ["c"] = 3; ["d"] = 4; ["e"] = 5; ["f"] = 6; ["g"] = 7; ["h"] = 8; ["i"] = 9; ["j"] = 10; ["k"] = 11;
    static ["s1"] = 1; static ["s2"] = 2;
    #p = 1; #q = 2;
    total() { return this.a1 + this.k + this.#p + this.#q + ManyComputed.s2; }
  }
  const spansLines = x => `a${x}
b`;
  function after() { return spansLines.toString().split("\n").length; }
  return [typeof second, fourth(), new ManyComputed().total(), 2 ** 10, 2 ** 16, spansLines(1).length, after()];
}
// A sloppy script's top-level block functions resolve their var scope with an opcode nothing else emits; `arguments`
// used only for its length has its own; a postfix increment whose value is used converts through op_to_numeric; two
// byte-identical functions share one instruction stream and one jump table in the payload; a string constant equal to
// an identifier written earlier points at that identifier's characters.
{
  function blockHoisted() { return "hoisted"; }
  function alsoHoisted() { return blockHoisted(); }
}
function argumentCount() { return arguments.length; }
function postfix(n) { const before = n++; const after = n--; return [before, after, n]; }
function twinA(x) { switch (x) { case 1: return "one"; case 2: return "two"; case 3: return "three"; default: return "many"; } }
function twinB(x) { switch (x) { case 1: return "one"; case 2: return "two"; case 3: return "three"; default: return "many"; } }
function sharedContents(o) { return [o.argumentCount, "argumentCount", "postfix", o.postfix].join(); }
//# sourceURL=features-corpus.js
//# sourceMappingURL=data:application/json;base64,e30=

record(classify(2, "gamma"), classify(9, "zeta"));
record(...literals());
const d = new Derived(1, 2);
record(d.describe(), d.publicField, Derived.isDerived(d), Derived.isDerived({}), Derived.tally(), Base.make(5).describe());
record(tdz(), sloppy());
record(...operators(7, 2, undefined));
record(...properties("k"));
record(...calls());
record(...sloppyOnly("a0", "b0"));
record(...functionForms());
record(...constants("c"));
record(...orderSensitive(true));
record(alsoHoisted(), argumentCount(1, 2, 3), postfix(5), twinA(2) + twinB(4), sharedContents({ argumentCount: 1, postfix: 2 }));
asyncStuff(2, "r1", "r2").then(seen => {
  record(seen);
  console.log(log.join("\n"));
});
