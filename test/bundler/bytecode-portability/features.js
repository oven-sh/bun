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

record(classify(2, "gamma"), classify(9, "zeta"));
record(...literals());
const d = new Derived(1, 2);
record(d.describe(), d.publicField, Derived.isDerived(d), Derived.isDerived({}), Derived.tally(), Base.make(5).describe());
record(tdz(), sloppy());
asyncStuff(2, "r1", "r2").then(seen => {
  record(seen);
  console.log(log.join("\n"));
});
