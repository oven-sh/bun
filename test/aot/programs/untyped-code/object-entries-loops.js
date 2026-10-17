// `for (const [k, v] of Object.entries(o))` in every form: what is taken from the pair, what the loop does to the object meanwhile, how the loop is left, and what kind of thing `o` is.
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : typeof held === "bigint" ? held + "n" : held);
const log = [];
function both(o) { const out = []; for (const [k, v] of Object.entries(o)) out.push(k, v); return out; }
function keyOnly(o) { let out = ""; for (const [k] of Object.entries(o)) out += k + ";"; return out; }
function valueOnly(o) { const out = []; for (const [, v] of Object.entries(o)) out.push(v); return out; }
function whole(o) { const out = []; for (const pair of Object.entries(o)) out.push(pair); return out; }
function wholeAndParts(o) { const out = []; for (const pair of Object.entries(o)) { const [k, v] = pair; pair.push(k + "!"); out.push(pair, v); } return out; }
function third(o) { const out = []; for (const [k, v, w] of Object.entries(o)) out.push(k, v, w); return out; }
function withDefault(o) { const out = []; for (const [k, v = "default", w = k + "?"] of Object.entries(o)) out.push(k, v, w); return out; }
function withRest(o) { const out = []; for (const [k, ...rest] of Object.entries(o)) out.push(k, rest, rest.length); return out; }
function nested(o) { const out = []; for (const [k, { a, b = k }] of Object.entries(o)) out.push(k, a, b); return out; }
function nestedArray(o) { const out = []; for (const [k, [first, second]] of Object.entries(o)) out.push(k, first, second); return out; }
function byIndex(o) { const out = []; for (const pair of Object.entries(o)) out.push(pair[0], pair[1], pair[2], pair.length); return out; }
function withLet(o) { const out = []; for (let [k, v] of Object.entries(o)) { k += "+"; v = [v]; out.push(k, v); } return out; }
function withVar(o) { for (var [k, v] of Object.entries(o)); return [k, v]; }
function toTargets(o) { const t = {}; const out = []; for ([t.k, t.v] of Object.entries(o)) out.push({ ...t }); return out; }
function closures(o) { const out = []; for (const [k, v] of Object.entries(o)) out.push(() => k + "=" + v); return out.map(f => f()); }
function changesValues(o) { const out = []; for (const [k, v] of Object.entries(o)) { for (const other in o) o[other] = "changed by " + k; out.push(k, v); } return [out, o]; }
function addsAndDeletes(o) { const out = []; let n = 0; for (const [k, v] of Object.entries(o)) { delete o[k]; o["added" + n++] = v; out.push(k, v); } return [out, Object.keys(o)]; }
function breaks(o) { const out = []; for (const [k, v] of Object.entries(o)) { if (v === 2) break; out.push(k); } return out; }
function continues(o) { const out = []; for (const [k, v] of Object.entries(o)) { if (v === 2) continue; out.push(k); } return out; }
function returns(o) { for (const [k, v] of Object.entries(o)) if (v === 2) return k; return "none"; }
function throwsInside(o) { try { for (const [k, v] of Object.entries(o)) if (v === 2) throw new Error("at " + k); } catch (e) { return e.message; } return "none"; }
function labeled(o, p) { const out = []; outer: for (const [k, v] of Object.entries(o)) { for (const [l, w] of Object.entries(p)) { if (w === v) continue outer; if (w > 2) break outer; out.push(k + l); } } return out; }
function sameTwice(o) { const out = []; for (const [k, v] of Object.entries(o)) for (const [l, w] of Object.entries(o)) out.push(k + l + (v === w)); return out; }
function inTry(o) { const out = []; try { for (const [k, v] of Object.entries(o)) out.push(k, v.x.y); } catch (e) { out.push(e.name); } finally { out.push("finally"); } return out; }
function* generator(o) { for (const [k, v] of Object.entries(o)) { const sent = yield [k, v]; if (sent) yield "sent " + sent + " at " + k; } }
async function asynchronous(o) { const out = []; for (const [k, v] of Object.entries(o)) out.push(k, await v); return out; }
function keptList(o) { const list = Object.entries(o); const out = []; for (const [k, v] of list) out.push(k, v); return [out, list.length, list[0]]; }
function conditional(o, c) { const out = []; for (const [k, v] of c ? Object.entries(o) : [["x", 1]]) out.push(k, v); return out; }
function mapped(o) { return Object.entries(o).map(([k, v]) => k + v).join(); }
function spreadList(o) { return [...Object.entries(o)].length; }
function extraArgument(o) { const out = []; for (const [k, v] of Object.entries(o, true)) out.push(k, v); return out; }
const plain = () => ({ a: 1, b: 2, c: 3 });
for (const f of [both, keyOnly, valueOnly, whole, wholeAndParts, third, withDefault, withRest, byIndex, withLet, withVar, toTargets, closures, changesValues, addsAndDeletes, breaks, continues, returns, throwsInside, sameTwice, keptList, mapped, spreadList, extraArgument])
  console.log(f.name, show(f(plain())), show(f({})), show(f({ only: undefined })));
console.log(show(nested({ p: { a: 1 }, q: { a: 2, b: 3 } })), show(nestedArray({ p: [1, 2], q: "xy", r: [] })), show(labeled(plain(), { x: 0, y: 2, z: 5 })), show(inTry({ a: { x: { y: 1 } }, b: {} })), show(conditional(plain(), true)), show(conditional(plain(), false)));
const pairs = whole(plain()); console.log(pairs[0] !== pairs[1], Array.isArray(pairs[0]), Object.getPrototypeOf(pairs[0]) === Array.prototype, pairs[0].length, show(Object.getOwnPropertyDescriptor(pairs[0], 0)), whole(plain())[0] !== pairs[0]);
const kinds = { array: [7, 8], holes: [1, , 3], string: "hi", number: 5, boolean: true, bigint: 10n, symbol: Symbol.iterator, func: Object.assign(function () {}, { own: 1 }), typed: new Uint8Array([4, 5]), map: new Map([[1, 2]]), date: new Date(0), regexp: /x/g,
  indexes: { 2: "two", b: "b", 1: "one", a: "a", [-1]: "minus" }, symbols: { [Symbol("s")]: 1, t: 2 }, nullProto: Object.assign(Object.create(null), { n: 1 }), inherits: Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true }, hidden: { value: 3 } }),
  frozen: Object.freeze({ f: 1 }), instance: new (class { x = 1; #y = 2; get z() { return 3; } })(), args: (function () { return arguments; })(1, 2), many: Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["k" + i, i])), boxed: Object("ab"), error: Object.assign(new Error("e"), { more: 1 }) };
for (const [name, value] of Object.entries(kinds)) console.log(name, show(both(value)), show(whole(value).length), keyOnly(value));
for (const nothing of [undefined, null]) for (const f of [both, whole, keyOnly]) try { f(nothing); console.log("no error"); } catch (e) { console.log(f.name, String(nothing), e.name + ": " + e.message); }
const getters = { get first() { log.push("get first"); delete this.third; this.added = 1; return 1; }, second: 2, get third() { log.push("get third"); return 3; }, get fourth() { log.push("get fourth"); return 4; } };
console.log(show(both(getters)), show(log.splice(0)));
const throwing = { a: 1, get b() { log.push("get b"); throw new RangeError("from b"); }, get c() { log.push("get c"); return 3; } };
try { both(throwing); } catch (e) { console.log(e.name, e.message, show(log.splice(0))); }
const proxy = new Proxy({ p: 1, q: 2, [Symbol("s")]: 3 }, { ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k) { log.push("get " + String(k)); return t[k]; } });
console.log(show(both(proxy)), show(log.splice(0)));
const g = generator(plain()); console.log(show([g.next(), g.next("x"), g.next(), g.next(), g.next(), g.next()]));
asynchronous({ a: Promise.resolve(1), b: 2, c: new Promise(resolve => resolve(3)) }).then(out => console.log("async", show(out)));
let sum = 0; const shapes = [plain(), { x: 1 }, { y: 1, z: 2, w: 3, v: 4, u: 5, t: 6, s: 7, r: 8 }, {}, [1, 2], { a: 1.5, b: "s" }];
for (let i = 0; i < 60000; i++) for (const [k, v] of Object.entries(shapes[i % shapes.length])) sum += k.length + (typeof v === "number" ? v : 0);
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
const kept = []; for (let i = 0; i < 30000; i++) for (const pair of Object.entries({ i, j: { i } })) if (i % 5000 === 0) kept.push(pair);
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
console.log(sum, show(kept));
