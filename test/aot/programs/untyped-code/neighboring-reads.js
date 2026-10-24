// Two reads by name that stand next to each other (`a.b.c`, `r.a` and `r.b`, `r.a` and `s.b`) and a read that is only tested (`if (o.x)`) are one call of a stub. Here: every form over receivers of every kind (own in line and out of line, inherited, absent, accessors, proxies, host objects, primitives, null and undefined), the order of what getters and traps see, the position in the stack of an error thrown by the first read and by the second, values kept alive across the call, and a receiver that changes its shape between the runs.
const log = [];
function say(...parts) { log.push(parts.map(String).join(" ")); }
function chain(a) { return a.b.c; }
function chain3(a) { return a.b.c.d; }
function chain4(a) { return a.b.c.d.e; }
function twice(a) { return a.b.c + ":" + a.b.d; }
function kept(a) { const b = a.b; return b.c + ":" + typeof b; }
function inCondition(a) { if (a.b.c) return "yes"; return "no"; }
function asArgument(a) { return String(a.b.c); }
function asReceiver(a) { return a.b.c.toString(); }
function stored(a, o) { o.x = a.b.c; return o.x; }
function inLoop(a) { let total = 0; for (let i = 0; i < 5; i++) total += a.b.c; return total; }
function inTry(a) { try { return a.b.c; } catch (error) { return "caught " + error.constructor.name; } }
function withLength(a) { return a.b.length; }
function lengthFirst(a) { return a.length.c; }
function optional(a) { return a?.b?.c; }
function thisChain() { return this.b.c; }
function liveAcross(a, x, y) { const v = a.b.c; return x + ":" + y + ":" + v; }
function both(a) { const { b, c } = a; return typeof b + ":" + String(c); }
function three(a) { const { b, c, d } = a; return typeof b + ":" + String(c) + ":" + String(d); }
function four(a) { const { b, c, d, e } = a; return [typeof b, String(c), String(d), String(e)].join(":"); }
function fromTwo(a, o) { const x = a.b, y = o.x; return typeof x + ":" + String(y); }
function fromTwoSwapped(a, o) { const y = o.x, x = a.b; return typeof x + ":" + String(y); }
function sameName(a, o) { const x = a.b, y = o.b; return typeof x + ":" + typeof y; }
function chainAndKeep(a) { const b = a.b, c = b.c; return typeof b + ":" + String(c); }
function chainThenSame(a) { const b = a.b, c = b.c, d = b.d; return typeof b + ":" + String(c) + ":" + String(d); }
function manyLive(a, o, p, q, r, s) { const x = a.b, y = o.x; return [typeof x, String(y), p, q, r, s].join(":"); }
function ifRead(a) { if (a.b) return "truthy"; return "falsy"; }
function ifNotRead(a) { if (!a.b) return "falsy"; return "truthy"; }
function ifSecond(a) { if (a.c) return "truthy c"; return "falsy c"; }
function whileRead(a) { let n = 0; while (a.c && n < 3) n++; return n; }
function andRead(a) { return a.b && a.c ? "both" : "not both"; }
function orRead(a) { return a.b || a.c ? "either" : "neither"; }
function ternaryRead(a) { return a.d ? 1 : 2; }
function ifChain(a) { if (a.b.c) return "chain truthy"; return "chain falsy"; }
function ifReadKept(a) { const b = a.b; if (b) return typeof b; return "falsy " + String(b); }
function chainOverLines(a) {
  return a
    .b
    .c;
}
function bothOverLines(a, o) {
  const x = a.b,
        y = o.x.z;
  return typeof x + ":" + String(y);
}
function fromTwoOverLines(a, o) {
  const x = a.b;
  const y = o.x;
  return typeof x + ":" + String(y);
}
const functions = { chainOverLines, bothOverLines, fromTwoOverLines, ifRead, ifNotRead, ifSecond, whileRead, andRead, orRead, ternaryRead, ifChain, ifReadKept, both, three, four, fromTwo, fromTwoSwapped, sameName, chainAndKeep, chainThenSame, chain, chain3, chain4, twice, kept, inCondition, asArgument, asReceiver, stored, inLoop, inTry, withLength, lengthFirst, optional };
function show(name, f, ...rest) { try { say(name, f(...rest)); } catch (error) { say(name, "threw", error.constructor.name, error instanceof TypeError && !globalThis.showsMessages ? "" : error.message, globalThis.showsMessages ? positionsOf(error) : ""); } }
function positionsOf(error) { return String(error.stack).split("\n").map(line => /(\d+:\d+)\)?$/.exec(line)?.[1]).filter(Boolean).slice(0, 3).join(" < "); }

let order = [];
class Inner { constructor() { this.c = "inner c"; this.d = { e: "deep" }; } }
class WithGetter { get b() { order.push("get b"); return { get c() { order.push("get c"); return "got c"; }, d: "d" }; } }
class Inherits extends Inner { }
const manyOwn = {}; for (let i = 0; i < 40; i++) manyOwn["p" + i] = i; manyOwn.b = { c: "out of line" };
const manyInner = {}; for (let i = 0; i < 40; i++) manyInner["q" + i] = i; manyInner.c = "inner out of line";
const dictionary = { b: { c: "dictionary" } }; for (let i = 0; i < 300; i++) dictionary["k" + i] = i; delete dictionary.k5;
const receivers = {
  plain: { b: { c: "c", d: "d" } },
  deep: { b: { c: { d: { e: "e" } } } },
  instance: { b: new Inner() },
  inheritedInner: { b: new Inherits() },
  inheritedOuter: Object.create({ b: { c: "from the prototype" } }),
  inheritedBoth: Object.create({ b: Object.create({ c: "both inherited" }) }),
  manyOwn, manyInner: { b: manyInner }, dictionary,
  getter: new WithGetter(),
  ownGetter: { get b() { order.push("own get b"); return { c: "own getter" }; } },
  throwingFirst: { get b() { throw new RangeError("first"); } },
  throwingSecond: { b: { get c() { throw new RangeError("second"); } } },
  changesItself: { get b() { delete this.b; this.b = { c: "second time" }; return { c: "first time" }; } },
  proxyOuter: new Proxy({}, { get(target, key) { order.push("proxy " + String(key)); return { c: "through a proxy" }; } }),
  proxyInner: { b: new Proxy({}, { get(target, key) { order.push("inner proxy " + String(key)); return "inner through a proxy"; } }) },
  missingFirst: {}, undefinedFirst: { b: undefined }, nullFirst: { b: null },
  missingSecond: { b: {} }, numberFirst: { b: 5 }, stringFirst: { b: "text" }, booleanFirst: { b: true }, symbolFirst: { b: Symbol.iterator }, bigintFirst: { b: 10n },
  arrayFirst: { b: [1, 2, 3] }, functionFirst: { b: function named(x, y) { } }, arrayOuter: Object.assign([1], { b: { c: "on an array" } }), functionOuter: Object.assign(function () { }, { b: { c: "on a function" } }),
  frozen: Object.freeze({ b: Object.freeze({ c: "frozen" }) }), nullPrototype: Object.assign(Object.create(null), { b: Object.assign(Object.create(null), { c: "no prototype" }) }),
  mapOuter: Object.assign(new Map(), { b: { c: "on a map" } }), dateInner: { b: Object.assign(new Date(0), { c: "on a date" }) }, regexpInner: { b: /x/g }, errorInner: { b: new Error("message") },
  stringObject: { b: new String("boxed") }, typedArray: { b: new Uint8Array(4) }, classObject: { b: Inner }, globalInner: { b: globalThis }, self: null,
  zero: { b: 0, c: 0, d: 0 }, minusZero: { b: -0, c: -0 }, notANumber: { b: NaN, c: NaN }, emptyString: { b: "", c: "" }, oneCharacter: { b: "x", c: "y" }, rope: { b: "ab".repeat(20) + String(1), c: "".concat("", "") }, falseValue: { b: false, c: false }, trueValue: { b: true, c: true },
  zeroBigInt: { b: 0n, c: 0n }, oneBigInt: { b: 1n, c: 1n }, double: { b: 0.5, c: 1e300 }, symbolValue: { b: Symbol.iterator, c: Symbol.iterator }, emptyObject: { b: {}, c: [] }, nullValue: { b: null, c: null },
  definesNext: { get b() { Object.defineProperty(this, "c", { value: "defined by b", configurable: true }); return { c: "inner" }; } },
  deletesNext: { get b() { delete this.c; return { c: "inner" }; }, c: "to be deleted" },
  growsItself: { get b() { for (let i = 0; i < 30; i++) this["g" + i] = i; return { c: "inner" }; }, c: "kept", d: "kept too" },
  accessorSecond: { b: 1, get c() { order.push("get c"); return "accessor c"; }, d: 2 },
  bothAccessors: { get b() { order.push("get b"); return { c: 1 }; }, get c() { order.push("get c"); return "c"; }, get d() { order.push("get d"); return "d"; }, get e() { order.push("get e"); return "e"; } },
  throwsSecond: { b: 1, get c() { throw new RangeError("c of the outer"); } },
};
receivers.self = { c: "self c" }; receivers.self.b = receivers.self;
for (const [receiverName, receiver] of Object.entries(receivers)) {
  for (const [name, f] of Object.entries(functions)) {
    order = [];
    show(receiverName + " " + name, f, receiver, { x: "ox", get b() { order.push("second get b"); return 1; } });
    if (order.length) say("  order", order.join(", "));
  }
  show(receiverName + " thisChain", thisChain.bind(receiver));
  show(receiverName + " liveAcross", liveAcross, receiver, "x", 2.5);
  show(receiverName + " manyLive", manyLive, receiver, { x: 1 }, "p", 2, "r", 4.5);
  show(receiverName + " fromTwo with nothing", fromTwo, receiver, undefined);
  show(receiverName + " fromTwo reversed", fromTwo, { b: 1 }, receiver);
}
for (const primitive of [undefined, null, 0, 1.5, "s", true, Symbol.iterator, 10n]) for (const [name, f] of Object.entries(functions)) show(typeof primitive + " " + name, f, primitive, { x: 1 });
const changing = { b: { c: 1 } };
for (let i = 0; i < 6; i++) { show("changing " + i, chain, changing); if (i === 1) changing.b = { x: 0, c: 2 }; if (i === 2) changing.extra = 1; if (i === 3) Object.defineProperty(changing, "b", { get() { return { c: "accessor now" }; } }); if (i === 4) Object.setPrototypeOf(changing, null); }
console.log(log.join("\n"));
