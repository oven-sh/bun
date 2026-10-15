// `{ ...base, ...(c ? { x: 1 } : {}) }`, `{ ...{ a, b } }`, `{ a, ...(c && { b }) }`: a literal that is written only to be spread: the keys in their order, later ones over earlier ones, and every case in which the literal is more than its written fields.
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : held) + " " + Object.keys(value).join();
const log = [];
const note = x => (log.push(x), x);
const base = { p: 1, q: 2 };
const cases = {
  only: (c, i) => ({ ...{ a: i, b: 2 } }),
  behindFields: (c, i) => ({ first: 0, ...{ a: i, b: 2 }, last: 9 }),
  conditional: (c, i) => ({ first: 0, ...(c ? { x: i } : {}) }),
  conditionalOrUndefined: (c, i) => ({ first: 0, ...(c ? { x: i, y: 2 } : undefined), last: 9 }),
  and: (c, i) => ({ first: 0, ...(c && { x: i }) }),
  behindObject: (c, i) => ({ ...base, ...(c ? { q: "over", r: i } : {}) }),
  aheadOfObject: (c, i) => ({ ...{ q: "under", r: i }, ...base }),
  overrides: (c, i) => ({ a: 1, b: 2, ...{ b: "over", c: i }, a: "last" }),
  twiceInLiteral: (c, i) => ({ ...{ a: 1, b: 2, a: i } }),
  two: (c, i) => ({ ...{ a: i }, ...{ b: 2 }, ...{ a: "again" } }),
  nested: (c, i) => ({ ...{ a: { ...{ b: i } } } }),
  spreadInSpread: (c, i) => ({ ...{ a: 1, ...{ b: i } } }),
  empty: (c, i) => ({ ...{} , a: i }),
  undefinedValue: (c, i) => ({ a: 1, ...{ a: undefined, b: i } }),
  order: (c, i) => ({ a: note("a"), ...{ b: note("b"), c: note("c") }, d: note("d") }),
  index: (c, i) => ({ z: 0, ...{ b: 1, 2: "two", a: 2, 1: "one" } }),
  indexInTarget: (c, i) => ({ 5: "five", ...{ b: 1 }, 3: "three" }),
  proto: (c, i) => ({ ...{ ["__proto__"]: i, a: 1 } }),
  protoSyntax: (c, i) => ({ ...{ __proto__: { inherited: 1 }, own: i } }),
  getter: (c, i) => ({ ...{ get a() { return note("got") + i; }, b: 2 } }),
  method: (c, i) => ({ ...{ m() { return i; }, a: 1 } }),
  computed: (c, i) => ({ ...{ [c ? "x" : "y"]: i, a: 1 } }),
  symbol: (c, i) => Object.getOwnPropertySymbols({ ...{ [Symbol.iterator]: i, a: 1 } }).length,
  keptToo: (c, i) => { const lit = { a: i }; const out = { ...lit, b: 2 }; lit.a = "changed"; return [out, lit]; },
  readToo: (c, i) => { const lit = { a: i, b: 2 }; return { ...lit, sum: lit.a + lit.b }; },
  storedBefore: (c, i) => { const lit = { a: i }; lit.b = 2; return { ...lit }; },
  deletedBefore: (c, i) => { const lit = { a: i, b: 2 }; delete lit.a; return { ...lit }; },
  intoItself: (c, i) => { const lit = { a: i }; return { lit, ...lit }; },
  inTry: (c, i) => { try { return { first: 0, ...(c ? { x: fails(i) } : { y: i }) }; } catch (e) { return { caught: e.message }; } },
  inLoop: (c, i) => { let out = {}; for (let j = 0; j < 3; j++) out = { ...out, ...{ ["k" + j]: j }, ...{ last: j } }; return out; },
  assign: (c, i) => Object.assign({ first: 0 }, { a: i }, c ? { b: 2 } : null),
  frozenTarget: (c, i) => { const t = Object.freeze({ a: 1 }); return { ...t, ...{ a: i } }; },
};
function fails(i) { if (i % 2) throw new Error("failed " + i); return i; }
for (const [name, f] of Object.entries(cases)) for (const c of [true, false]) console.log(name, c, show(f(c, 1)), show(f(c, 2)), log.splice(0).join());
let sum = 0; for (let i = 0; i < 150000; i++) { const o = { first: i, ...(i & 1 ? { x: i } : {}), ...(i & 2 && { y: 1, z: 2 }) }; sum += Object.keys(o).length + (o.x ?? 0); } console.log(sum);
