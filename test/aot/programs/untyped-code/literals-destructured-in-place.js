// An object literal that is read by name, or taken apart by a pattern, in the function that made it or in one small enough to be inlined there: what is read is what was written, in every case where it is not that simple too.
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : held);
const log = [];
function area({ width, height, scale }) { return width * height * scale; }
function areaOf(o) { return o.width * o.height * o.scale; }
function pair(i) { return { low: i, high: i + 1 }; }
function withDefaults({ a = "da", b = "db", c = "dc" } = {}) { return a + b + c; }
function renamed({ a: x, b: { c: y } }) { return [x, y]; }
function restOf({ a, ...others }) { return [a, others]; }
function note(x) { log.push(x); return x; }
const cases = {
  options: i => area({ width: i, height: 2, scale: 0.5 }),
  byName: i => areaOf({ width: i, height: 2, scale: 0.5 }),
  returned: i => { const { low, high } = pair(i); return low * high; },
  returnedByName: i => pair(i).high,
  absent: i => { const { low, missing } = pair(i); return [low, missing]; },
  inherited: i => { const { toString, hasOwnProperty, constructor, low } = pair(i); return [typeof toString, typeof hasOwnProperty, constructor === Object, low]; },
  proto: i => [{ a: i }.__proto__ === Object.prototype, { __proto__: null, a: i }.a, { __proto__: { inherited: i } }.inherited, { ["__proto__"]: i }.__proto__ === i],
  defaults: i => [withDefaults({ a: i }), withDefaults({ b: undefined, c: null }), withDefaults(), withDefaults({})],
  renamed: i => renamed({ a: i, b: { c: i + 1 } }),
  rest: i => restOf({ a: i, b: 2, c: 3 }),
  twice: i => { const o = { a: i, a: i + 1 }; return o.a; },
  order: i => { const o = { a: note("a" + i), b: note("b" + i) }; return o.b + o.a; },
  storedAfter: i => { const o = { a: i }; o.a = i + 1; return o.a; },
  storedBetween: i => { const o = { a: i }; const before = o.a; o.a = "later"; return [before, o.a]; },
  added: i => { const o = { a: i }; o.b = i + 1; return [o.a, o.b]; },
  deleted: i => { const o = { a: i, b: 2 }; delete o.a; return [o.a, o.b, "a" in o]; },
  getter: i => { const o = { get a() { return note("got") + i; }, b: i }; return [o.a, o.b, o.a]; },
  setter: i => { const o = { set a(v) { note("set " + v); }, b: i }; o.a = 1; return [o.a, o.b]; },
  getterOverField: i => { const o = { a: i, get a() { return "getter"; } }; return o.a; },
  fieldOverGetter: i => { const o = { get a() { return "getter"; }, a: i }; return o.a; },
  method: i => { const o = { a: i, m() { return this.a; } }; return o.m(); },
  methodChanges: i => { const o = { a: i, m() { this.a = "changed"; } }; o.m(); return o.a; },
  handedOut: i => { const o = { a: i }; change(o); return o.a; },
  closure: i => { const o = { a: i }; const f = () => { o.a = "by closure"; }; f(); return o.a; },
  spreadOver: i => { const o = { a: i, ...{ a: "spread" } }; return o.a; },
  spreadUnder: i => { const o = { ...{ a: "spread" }, a: i }; return o.a; },
  computed: i => { const k = i % 2 ? "a" : "b"; const o = { a: 1, [k]: "computed", b: 2 }; return [o.a, o.b]; },
  index: i => { const o = { 0: i, 1: i + 1, a: 2 }; return [o[0], o["1"], o.a]; },
  inOperator: i => { const o = { a: i, u: undefined }; return ["a" in o, "u" in o, "z" in o, "toString" in o]; },
  conditional: i => { const o = i % 2 ? { a: "odd" } : { a: "even", b: 1 }; return [o.a, o.b]; },
  inLoop: i => { let t = 0; for (let j = 0; j < 4; j++) { const { x, y } = { x: i + j, y: j }; t += x * y; } return t; },
  acrossBranch: i => { const o = { a: i, b: 2 }; if (i % 2) return o.a; return o.b; },
  inTry: i => { try { const { a, b } = { a: i, b: fails(i) }; return a + b; } catch (e) { return e.message; } },
  identity: i => { const o = { a: i }; return [o === o, o.a, typeof o, o == null, o === undefined, !o]; },
  nestedRead: i => ({ a: { b: { c: i } } }).a.b.c,
  self: i => { const o = { a: i }; o.self = o; return o.self.self.a; },
  frozen: i => { const o = Object.freeze({ a: i }); return o.a; },
  nullish: i => [({ a: i })?.a, ({ a: null }).a ?? "was null", ({ a: undefined }).a ?? "was undefined"],
  nan: i => { const { a, b } = { a: NaN, b: -0 }; return [Object.is(a, NaN), Object.is(b, -0)]; },
  kinds: i => { const o = { a: i }, l = [i], f = () => i; return [typeof o === "object" && o !== null ? o.a : -1, typeof l, typeof o === "function", typeof f === "function", typeof l === "object" ? l[0] : -1, typeof o === "undefined", Array.isArray(o), Array.isArray(l)]; },
  nestedPattern: i => { const { style: { color, size = "m" }, id } = { style: { color: "c" + i }, id: i }; return [color, size, id]; },
  nestedOuterHandedOut: i => { const o = { a: { b: i } }; changeInner(o); return o.a.b; },
  nestedInnerHandedOut: i => { const inner = { b: i }; const o = { a: inner }; change2(inner); return o.a.b; },
  nestedInnerStored: i => { const inner = { b: i }; const o = { a: inner }; inner.b = "stored"; return o.a.b; },
  nestedThroughOuterStored: i => { const o = { a: { b: i } }; o.a.b = "through"; return o.a.b; },
  nestedTwoHolders: i => { const inner = { b: i }; const o = { a: inner }, p = { a: inner }; changeInner(p); return [o.a.b, o.a === p.a]; },
  nestedThree: i => ({ a: { b: { c: { d: i } } } }).a.b.c.d,
  nestedReturned: i => { const o = { a: { b: i } }; const inner = o.a; return [inner, inner.b]; },
  nestedInArray: i => { const o = { a: [{ b: i }] }; return o.a[0].b; },
  functionValue: i => { const { f } = { f: x => x + i }; return f(1); },
  thisOfTaken: i => { const { m } = { v: i, m() { return this === undefined; } }; return m(); },
};
function change(o) { o.a = "changed elsewhere"; }
function changeInner(o) { o.a.b = "inner changed elsewhere"; }
function change2(o) { o.b = "changed elsewhere"; }
function fails(i) { if (i % 2) throw new Error("failed " + i); return 1; }
for (const [name, f] of Object.entries(cases)) console.log(name, show(f(1)), show(f(2)), show(log.splice(0)));
for (const nothing of [undefined, null]) try { area(nothing); } catch (e) { console.log(e.name); }
let sum = 0; for (let i = 0; i < 200000; i++) { const { low, high } = pair(i); sum += area({ width: low, height: high - low, scale: 0.5 }) + areaOf({ width: 1, height: 1, scale: i & 1 }); } console.log(sum);
