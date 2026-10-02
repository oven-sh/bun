const say = (what, got) => console.log(what + ": " + (typeof got === "string" ? got : JSON.stringify(got, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "fn" : v))));
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
const warm = (f, n = 200) => { let r; for (let i = 0; i < n; i++) r = f(i); return r; };

class A {} class B extends A {} class C extends B {} class D extends C {} class Other {}
function F() {} function G() {} G.prototype = Object.create(F.prototype);
const isA = x => x instanceof A, isC = x => x instanceof C, isF = x => x instanceof F;
const things = [new A, new B, new C, new D, new Other, new F, new G, {}, [], () => 1, Object.create(null), Object.create(new C)];
say("classes", warm(() => things.map(x => [isA(x), isC(x), isF(x)].map(Number).join("")).join()));
say("what is no object", [1, "s", true, null, undefined, 1n, Symbol()].map(x => isA(x)));
say("built-ins", [[] instanceof Array, [] instanceof Object, new Map instanceof Map, new Map instanceof Set, /x/ instanceof RegExp, new Date instanceof Date, (() => 1) instanceof Function, new TypeError instanceof Error, Promise.resolve() instanceof Promise, Object.create(null) instanceof Object]);
const against = (x, c) => x instanceof c;
say("one site, many constructors", warm(i => [A, B, C, D, Other, F, G, Object, Array, Function].map(c => Number(against(things[i % things.length], c))).join("")));
say("the right side is no object", [1, "s", null, undefined, Symbol.iterator].map(c => attempt(() => against({}, c))));
say("not callable", [attempt(() => against({}, {})), attempt(() => against(1, {})), attempt(() => against({}, Object.create(F)))]);
say("no prototype property", [attempt(() => against({}, () => 1)), attempt(() => against(1, () => 1)), attempt(() => against({}, { m() {} }.m)), attempt(() => against({}, Function.prototype)), attempt(() => against({}, Math.max))]);
{
  class P {} class Q extends P {} class R extends Q {}
  const isR = x => x instanceof R, o = new R, log = [];
  log.push(warm(() => isR(o)), warm(() => isR({})));
  Object.defineProperty(P, Symbol.hasInstance, { value: x => x === 7, configurable: true });
  log.push(isR(o), isR(7), isR({}));
  delete P[Symbol.hasInstance];
  log.push(warm(() => isR(o)), isR(7));
  Object.defineProperty(R, Symbol.hasInstance, { get() { log.push("got"); return () => "truthy"; }, configurable: true });
  log.push(isR(1), isR(o));
  delete R[Symbol.hasInstance];
  Object.defineProperty(Q, Symbol.hasInstance, { value: undefined, configurable: true });
  log.push(isR(o), isR({}));
  Object.defineProperty(Q, Symbol.hasInstance, { value: 5, configurable: true });
  log.push(attempt(() => isR(o)));
  say("Symbol.hasInstance, late", log);
}
{ class S { static [Symbol.hasInstance](x) { return x === "yes"; } } class T extends S {}
  say("Symbol.hasInstance, declared", warm(() => ["yes" instanceof S, new S instanceof S, "yes" instanceof T, new T instanceof T])); }
{ function H() {} const isH = x => x instanceof H, h = new H, log = [warm(() => isH(h))];
  H.prototype = {}; log.push(isH(h), isH(new H), warm(() => isH(new H)));
  H.prototype = 5; log.push(attempt(() => isH(h)), attempt(() => isH(1)));
  H.prototype = Object.getPrototypeOf(h); log.push(isH(h));
  say("prototype assigned", log); }
{ const o = new C, log = [warm(() => isC(o))];
  Object.setPrototypeOf(o, Other.prototype); log.push(isC(o), o instanceof Other);
  Object.setPrototypeOf(o, null); log.push(isC(o));
  Object.setPrototypeOf(o, D.prototype); log.push(warm(() => isC(o)));
  class M extends C {} const m = new M; log.push(warm(() => isC(m)));
  Object.setPrototypeOf(M.prototype, Other.prototype); log.push(isC(m), m instanceof Other);
  Object.setPrototypeOf(M, Other); log.push(m instanceof M);
  say("prototypes changed", log); }
{ const log = [], trap = name => new Proxy(function () {}, { get(t, k) { log.push(name + " get " + String(k)); return k === "prototype" ? C.prototype : Reflect.get(t, k); } });
  const p = trap("right"); say("a proxy on the right", [against(new C, p), against({}, p), against(1, p), log.join()]);
  const log2 = [], left = new Proxy({}, { getPrototypeOf() { log2.push("asked"); return C.prototype; } });
  say("a proxy on the left", [warm(() => isC(left), 3), isA(left), isF(left), log2.length]);
  say("a proxy in the chain", [isC(Object.create(left)), isF(Object.create(Object.create(left)))]);
  say("a proxy that throws", attempt(() => isC(new Proxy({}, { getPrototypeOf() { throw new RangeError("no"); } })))); }
{ const bound = C.bind(null), twice = bound.bind(null); say("bound functions", warm(() => [new C instanceof bound, new B instanceof bound, new D instanceof twice, 1 instanceof bound])); }

const words = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super".split(" ");
const list = w => new RegExp("^(?:" + w.join("|") + ")$");
const keywords = list(words);
const inputs = [...words, "", "brea", "breakk", "xbreak", "break ", " break", "break\n", "\nbreak", "BREAK", "do|else", "doelse", "i", "in", "ins", "superduper", "x".repeat(50), "ca" + "se", ("xx" + "case").slice(2), "caseĀ".slice(0, 4), "Ā", "casе"];
say("test", warm(() => inputs.map(s => Number(keywords.test(s))).join("")));
say("exec", ["case", "cases", ""].map(s => { const m = keywords.exec(s); return m && [m[0], m.index, m.length, m.input, m.groups]; }));
say("through strings", ["case".match(keywords), "cases".match(keywords), "case".search(keywords), "x".search(keywords), "case".replace(keywords, "[$&]"), "cases".replace(keywords, "!"), "case".split(keywords), "case".replace(keywords, (...a) => a.join("/"))]);
keywords.test("while"); say("legacy statics", [RegExp.lastMatch, RegExp["$`"], RegExp["$'"], RegExp.input, RegExp.$1]);
for (const flags of ["g", "y", "gy", "i", "m", "s", "u", "v", "d", "gi", "gm"]) {
  const r = new RegExp(keywords.source, flags), out = [];
  for (const s of ["case", "CASE", "x\ncase", "case\nx", "cases"]) { r.lastIndex = 0; out.push(Number(r.test(s)) + ":" + r.lastIndex); r.lastIndex = 1; out.push(Number(r.test(s)) + ":" + r.lastIndex); }
  const m = (r.lastIndex = 0, r.exec("case")); say("flags " + flags, out.join() + " " + (m && m.indices ? JSON.stringify(m.indices) : ""));
}
const near = ["^(?:a|b)", "(?:a|b)$", "^(a|b)$", "^(?:a|b)+$", "^(?:a|b)?$", "^(?:|a)$", "^(?:a|)$", "^(?:a)$", "^(?:ab|a.)$", "^(?:a\\.b|c)$", "^(?:a\\||\\$b)$", "^(?:a|b)$|c", "^(?:a|[bc])$", "^(?:a|b|a)$", "^(?:a|(?:b|c))$", "^(?=a)(?:a|b)$", "^(?:\\u0100|b)$", "^(?:a|b)$$", "^^(?:a|b)$", "^(?:ab|abc|abcd)$", "^(?<n>a|b)$", "^(?:a{2}|b)$", "^(?:\\n|b)$", "^(?!a|b)$", "^(?:\\d|b)$"];
const probes = ["", "a", "b", "c", "ab", "abc", "abcd", "aa", "a.b", "axb", "a|", "$b", "ba", "Ā", "\n", "a\n", "1", "xc"];
for (const source of near) say("near " + source, warm(() => { const r = new RegExp(source); return probes.map(s => Number(r.test(s))).join(""); }, 3));
say("written out", warm(() => ["if", "else", "elses", ""].map(s => /^(?:if|else)$/.test(s))));
say("many words", (() => { const w = Array.from({ length: 500 }, (_, i) => "w" + i.toString(36)), r = list(w); return [w.every(s => r.test(s)), r.test("w"), r.test("w" + (500).toString(36)), r.test("w0w1")]; })());

class Base { constructor(i) { this.kind = "k" + i; this.flag = i % 2 === 0; this.parent = null; this.n = i; } }
const subclasses = Array.from({ length: 12 }, (_, i) => eval(`(class S${i} extends Base { constructor() { super(${i}); this.own${i} = ${i}; this.last = "l${i}"; } })`));
const kindOf = o => o.kind, nOf = o => o.n, flagOf = o => o.flag, lastOf = o => o.last, parentOf = o => o.parent;
const instances = subclasses.map(S => new S);
say("fields of the base class", warm(() => instances.map(o => kindOf(o) + nOf(o) + Number(flagOf(o)) + lastOf(o) + parentOf(o)).join()));
{ const o = new subclasses[3], log = [warm(() => nOf(o))];
  o.extra = 1; log.push(nOf(o), kindOf(o));
  Object.defineProperty(o, "n", { get() { return "getter"; }, configurable: true }); log.push(nOf(o), warm(() => nOf(o)), nOf(instances[3]));
  Object.defineProperty(o, "n", { value: 42, writable: false, enumerable: false, configurable: true }); log.push(nOf(o));
  delete o.n; log.push(nOf(o)); o.n = "again"; log.push(nOf(o), kindOf(o), flagOf(o));
  delete o.kind; log.push(kindOf(o), nOf(o), flagOf(o));
  say("one object changes", log); }
{ const o = new subclasses[5]; warm(() => kindOf(o)); Object.freeze(o); const p = new subclasses[5]; Object.seal(p); const q = new subclasses[5]; Object.preventExtensions(q);
  say("frozen, sealed, not extensible", [kindOf(o), nOf(o), kindOf(p), nOf(p), kindOf(q), nOf(q)]); }
{ const shapes = [{ kind: "a", n: 1 }, { n: 2, kind: "b" }, { x: 0, kind: "c", n: 3 }, { get kind() { return "g"; }, n: 4 }, { kind: "e" }, Object.create({ kind: "inherited", n: 6 }), Object.assign(Object.create(null), { kind: "null proto", n: 7 }), Object.assign(() => 1, { kind: "fn", n: 8 }), Object.assign([], { kind: "arr", n: 9 }), new Proxy({ kind: "t", n: 10 }, {}), "str", 5, { __proto__: { get n() { return "pg"; } }, kind: "h" }];
  say("other shapes at the same sites", warm(() => shapes.map(o => kindOf(o) + "/" + nOf(o)).join())); }
{ const d = new subclasses[7]; for (let i = 0; i < 200; i++) d["p" + i] = i; for (let i = 0; i < 150; i++) delete d["p" + i];
  const log = [warm(() => kindOf(d) + nOf(d))]; delete d.kind; d.kind = "moved"; log.push(warm(() => kindOf(d) + nOf(d))); say("a dictionary", log); }
{
  const ab = i => ({ a: "a" + i, b: "b" + i }), ba = i => ({ b: "b" + i, a: "a" + i }), getA = o => o.a, getB = o => o.b;
  say("names that swap places", warm(i => [ab(i), ba(i), { a: 1 }, { b: 2 }, { c: 0, a: 3 }].map(o => getA(o) + ":" + getB(o)).join())); }
{ const s = Symbol("s"), get = o => o[s]; say("a symbol for a name", warm(i => [{ [s]: 1 }, { [s]: 2, x: 1 }, { x: 1, [s]: 3 }, {}].map(get))); }
{ const make = n => { const o = {}; for (let i = 0; i < n; i++) o["f" + i] = i; o.tail = "t" + n; return o; }, tailOf = o => o.tail;
  say("at every offset", warm(() => Array.from({ length: 14 }, (_, n) => tailOf(make(n))).join())); }
{ let names = 0; const o = {}; for (let i = 0; i < 70000; i++) { const p = { ["n" + i]: i }; names += Function("o", "return o.n" + (i % 3))(i % 3 === i ? p : { n0: 0, n1: 1, n2: 2 }); if (i > 300) break; } say("sites made at run time", names); }

{ const typeOf = o => o.type, alsoTypeOf = o => o.type;
  const pad = n => { const o = {}; for (let i = 0; i < n; i++) o["p" + i] = i; return o; };
  const at = (n, extra) => { const o = pad(n); o.type = "t" + n; for (let i = 0; i < extra; i++) o["x" + i] = i; return o; };
  const many = []; for (let n = 0; n < 20; n++) for (let extra = 0; extra < 3; extra++) many.push(at(n, extra));
  say("one name at twenty offsets", warm(() => many.map(typeOf).join()));
  say("another site, after the first", warm(() => many.map(alsoTypeOf).join()));
  { const log = [];
    for (let n = 0; n < 6; n++) { const o = pad(n); log.push(typeOf(o)); o.type = "late" + n; log.push(typeOf(o)); o.more = 1; log.push(typeOf(o)); delete o.type; log.push(typeOf(o)); o.type = "again" + n; log.push(typeOf(o)); }
    say("the name arrives, leaves and comes back", log); }
  const odd = [{ get type() { return "getter"; } }, Object.defineProperty({}, "type", { value: "read-only", writable: false, enumerable: true, configurable: true }),
    Object.defineProperty({}, "type", { value: "hidden", writable: true, enumerable: false, configurable: true }), Object.freeze({ type: "frozen" }), Object.seal({ type: "sealed" }),
    Object.preventExtensions({ type: "not extensible" }), Object.create({ type: "inherited" }), Object.create(null), Object.assign(Object.create(null), { type: "no prototype" }),
    Object.assign([], { type: "array" }), Object.assign(() => 1, { type: "function" }), Object.assign(new String("s"), { type: "string object" }), Object.assign(new Map, { type: "map" }),
    Object.assign(/x/, { type: "regexp" }), Object.assign(new Uint8Array(2), { type: "typed array" }), Object.assign(new Error("e"), { type: "error" }),
    new Proxy({ type: "target" }, { get: (t, k) => "trapped " + String(k) }), new Proxy({ type: "target" }, {}), (function () { arguments.type = "arguments"; return arguments; })(),
    new (class { type = "field"; }), new (class { get type() { return "class getter"; } }), new (class { static type = "static"; }), class { static type = "static"; },
    "a string", 7, true, Symbol.iterator, 1n];
  say("not plain", warm(() => odd.map(typeOf)));
  say("neither", [null, undefined].map(x => attempt(() => typeOf(x))));
  { const d = at(2, 0); for (let i = 0; i < 200; i++) d["q" + i] = i; for (let i = 0; i < 199; i++) delete d["q" + i];
    const log = [warm(() => typeOf(d))]; delete d.type; log.push(typeOf(d)); d.type = "moved"; log.push(warm(() => typeOf(d))); delete d.p0; d.z = 1; log.push(typeOf(d), Object.keys(d).join());
    say("a dictionary with the name", log); }
  { const g = at(1, 1), log = [warm(() => typeOf(g))];
    Object.defineProperty(g, "type", { get() { return "now a getter"; }, configurable: true }); log.push(typeOf(g), typeOf(at(1, 1)));
    Object.defineProperty(g, "type", { value: "a value again", writable: true, enumerable: true, configurable: true }); log.push(typeOf(g), warm(() => typeOf(g)), typeOf(at(1, 1)));
    say("a getter and back", log); }
  { const proto = {}, kids = [Object.create(proto), Object.assign(Object.create(proto), { a: 1 }), Object.assign(Object.create(proto), { type: "own" }), Object.assign(Object.create(proto), { a: 1, type: "own too" })];
    const log = [warm(() => kids.map(typeOf))]; proto.type = "from the prototype"; log.push(kids.map(typeOf), warm(() => kids.map(typeOf)));
    delete kids[2].type; log.push(kids.map(typeOf)); delete proto.type; log.push(kids.map(typeOf));
    Object.setPrototypeOf(kids[0], { type: "another prototype" }); log.push(kids.map(typeOf));
    say("a prototype gets the name", log); }
  say("values", warm(() => [{ type: undefined }, { type: null }, { type: 0 }, { type: "" }, { type: false }, { a: 1, type: -1 }, { a: 1, b: 2, type: [] }, { a: 1, b: 2, c: 3, type: {} }].map(typeOf)));
  {
    const setType = (o, v) => { o.type = v; }, log = [];
    for (const o of many) setType(o, typeOf(o) + "!");
    log.push(many.map(typeOf).join()); const fresh = pad(3); setType(fresh, "set"); log.push(typeOf(fresh), Object.keys(fresh).join());
    say("written and read", log); }
  {
    const kindOf = o => o.kind, pairs = [];
    for (let n = 0; n < 5; n++) { const a = pad(n); a.type = "T" + n; a.kind = "K" + n; const b = pad(n); b.kind = "k" + n; b.type = "t" + n; pairs.push(a, b, Object.assign(pad(n), { kind: "only kind" }), Object.assign(pad(n), { type: "only type" })); }
    say("two names in the same slots", warm(() => pairs.map(o => typeOf(o) + "/" + kindOf(o)).join())); }
}

{ const copy = o => ({ ...o }), copyAnd = o => ({ ...o, extra: 1 }), over = o => ({ ...o, a: "over" }), before = o => ({ first: 0, ...o });
  const lit = i => ({ a: i, b: "b" + i, c: [i] });
  say("a copy", warm(i => copy(lit(i))));
  say("another object with the same values", (o => [copy(o) !== o, copy(o).c === o.c])(lit(1)));
  say("keys in order", [Object.keys(copy({ z: 1, y: 2, x: 3 })).join(), Object.keys(copyAnd({ z: 1, y: 2 })).join(), Object.keys(before({ z: 1, first: 2 })).join()]);
  say("and more", warm(i => copyAnd(lit(i))));
  say("overwritten", warm(i => over(lit(i))));
  say("after another property", warm(i => before(lit(i))));
  { const o = lit(1), c = warm(() => copy(o)); c.a = "changed"; c.d = "added"; delete c.b; say("the copy is independent", [o, c, copy(o)]); }
  { const o = lit(2), log = [warm(() => copy(o))];
    o.d = 4; log.push(copy(o)); delete o.a; log.push(copy(o));
    Object.defineProperty(o, "g", { get() { return "got " + this.d; }, enumerable: true, configurable: true }); log.push(copy(o), Object.getOwnPropertyDescriptor(copy(o), "g").value);
    Object.defineProperty(o, "h", { value: "hidden", enumerable: false }); log.push(Object.keys(copy(o)).join());
    o[Symbol.for("s")] = "symbol"; log.push(Object.getOwnPropertySymbols(copy(o)).length, copy(o)[Symbol.for("s")]);
    o[0] = "indexed"; log.push(copy(o), Object.keys(copy(o)).join());
    say("the source changes", log); }
  { const f = Object.freeze(lit(3)), s = Object.seal(lit(4)), c = warm(() => copy(f)), d = warm(() => copy(s)); c.a = "writable"; c.n = "extensible"; delete d.a;
    say("of a frozen and a sealed object", [c, Object.isFrozen(c), Object.isExtensible(c), d, Object.isSealed(d)]); }
  { const r = Object.defineProperty(lit(5), "a", { value: "read-only", writable: false, enumerable: true, configurable: false }), c = warm(() => copy(r)); c.a = "written";
    say("of an object with a read-only property", [c, Object.getOwnPropertyDescriptor(c, "a")]); }
  { class K { constructor() { this.a = 1; this.b = 2; } m() {} get g() { return 3; } } const c = warm(() => copy(new K));
    say("of an instance", [c, Object.getPrototypeOf(c) === Object.prototype, "m" in c, "g" in c]); }
  { const p = Object.create({ inherited: 1 }); p.own = 2; say("inherited properties are left out", warm(() => copy(p))); }
  { const n = Object.assign(Object.create(null), { a: 1 }), c = warm(() => copy(n)); say("of an object without a prototype", [c, Object.getPrototypeOf(c) === Object.prototype]); }
  { const grown = {}; for (let i = 0; i < 40; i++) grown["k" + i] = i;
    const wide = { a0: 0, a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8, a9: 9, a10: 10, a11: 11, a12: 12, a13: 13, a14: 14, a15: 15, a16: 16, a17: 17, a18: 18, a19: 19 };
    say("many properties", warm(() => [Object.keys(copy(grown)).length, copy(grown).k39, Object.keys(copy(wide)).join(), copy(wide).a19])); }
  say("of what is no object", [copy(null), copy(undefined), copy(1), copy("ab"), copy(true), copy([1, 2]), copy(() => 1), copy(Symbol.iterator), copy(1n)]);
  say("an empty object", [copy({}), Object.keys(copyAnd({})).join()]);
  say("a getter is called", warm(i => copy({ a: i, get b() { return this.a + 1; } })));
  { let calls = 0; const o = { get a() { return ++calls; } }; copy(o); copy(o); say("once for each copy", calls); }
  { const setA = (o, v) => { o.a = v; return o; }, getB = o => o.b; say("written and read after copying", warm(i => [setA(copy(lit(i)), "set"), getB(copy(lit(i)))])); }
  { const two = i => (i & 1 ? { a: i, b: "b", c: [] } : { c: [], b: "b", a: i }); say("the same names in another order", warm(i => Object.keys(copy(two(i))).join() + "/" + Object.keys(copy(two(i + 1))).join())); }
  { const nested = i => ({ outer: { inner: i }, list: [{ x: i }] }), c = copy(nested(1)), o = nested(2), d = copy(o); d.outer.inner = "shared"; say("copies are shallow", [c, o.outer.inner]); }
  { let sum = 0; for (let i = 0; i < 20000; i++) sum += copy(lit(i)).a + copyAnd(lit(i)).extra; say("many copies", sum); }
}

{ const typeOf = o => o.type, viaHelper = o => typeOf(o), twoDown = o => viaHelper(o);
  const isA = o => o.type === "a", isNotB = o => "b" !== o.type, hasKind = o => o.kind === "k" && o.type === "a";
  class WithField { constructor(t) { this.type = t; } } class WithGetter { get type() { return "from a getter"; } } class Inherits extends WithField {}
  const rope = s => s + "", built = ["a"].join(""), cut = "xay".slice(1, 2), wide = "aĀ".slice(0, 1);
  const make = () => [
    { type: "a" }, { type: "b", x: 1 }, { type: "a", x: 1, y: 2 }, { x: 1, type: "a" }, { x: 1, y: 2, type: "b" }, { x: 1, y: 2, z: 3, type: "a" },
    { kind: "k", type: "a" }, { type: "a", kind: "k" }, { kind: "k" }, {}, { type: undefined }, { type: null }, { type: 0 }, { type: ["a"] }, { type: { type: "a" } },
    { type: rope("a") }, { type: built }, { type: cut }, { type: wide }, { type: "a".repeat(3) }, { type: "" }, { type: new String("a") }, { type: Symbol.for("a") },
    new WithField("a"), new WithField("b"), new WithGetter, new Inherits("a"), Object.create({ type: "a" }), Object.create(null), Object.assign(Object.create(null), { type: "a" }),
    Object.freeze({ type: "a" }), Object.defineProperty({}, "type", { value: "a", enumerable: false }), { get type() { return "a"; } }, { a0: 0, a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8, a9: 9, a10: 10, a11: 11, a12: 12, a13: 13, a14: 14, a15: 15, a16: 16, a17: 17, type: "a" },
    new Proxy({ type: "b" }, { get: (t, k) => (k === "type" ? "a" : t[k]) }), ["a"], Object.assign([], { type: "a" }), Object.assign(() => 1, { type: "a" }), "a", 1, true, 1n, Symbol.iterator, /a/, new Map([["type", "a"]]), JSON.parse('{"type":"a"}'), JSON.parse('{"x":1,"type":"b"}'),
  ];
  const show = v => (typeof v === "symbol" ? v.toString() : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
  const round = objects => { const log = [];
    for (const o of objects) log.push(show(o.type));
    for (let i = 0; i < objects.length; i++) { const o = objects[i]; log.push(o.type === "a" ? "A" : "b" === o.type ? "B" : "-"); }
    for (const o of objects) log.push(show(typeOf(o)) === show(viaHelper(o)) && show(viaHelper(o)) === show(twoDown(o)) ? "=" : "DIFFERENT");
    let n = 0; for (let i = objects.length - 1; i >= 0; i--) if (isA(objects[i]) && isNotB(objects[i])) n++;
    log.push(n, objects.filter(isA).length, objects.filter(isNotB).length, objects.some(hasKind), objects.findIndex(hasKind), objects.map(typeOf).filter(t => t === "a").length, objects.reduce((sum, o) => sum + (o.type === "b"), 0));
    return log.join(" "); };
  const objects = make(); let first; for (let i = 0; i < 40; i++) first = round(objects);
  say("every kind of base", first);
  say("fresh objects with warm sites", round(make()) === first);
  objects[0].type = "b"; objects[1].added = 1; delete objects[2].x; objects[3].type = rope("a"); Object.defineProperty(objects[4], "type", { get() { return "a"; }, configurable: true });
  delete objects[5].type; objects[9].type = "a"; Object.setPrototypeOf(objects[8], { type: "a" }); WithField.prototype.kind = "k"; Object.getPrototypeOf(objects[27]).type = "b"; objects[28].type = "a";
  say("after the objects change", round(objects));
  delete WithField.prototype.kind; Object.setPrototypeOf(objects[8], Object.prototype); objects[27].type = "own";
  say("and change again", round(objects));
  const failing = []; for (const bad of [null, undefined]) { try { for (const o of [{ type: "a" }, bad]) failing.push(o.type); } catch (e) { failing.push(e.constructor.name); } try { failing.push(twoDown(bad)); } catch (e) { failing.push(e.constructor.name); } }
  say("of null and undefined", failing);
}
