// Object literals whose members' values branch (`? :`, `??`, `||`, `&&`, `?.`), loop, throw or yield: the order of evaluation, the order of the properties, one object an evaluation, and what is seen when a value looks at things half way.
const log = [];
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : held);
const say = (...parts) => log.push(parts.map(part => typeof part === "string" ? part : show(part)).join(" "));
const note = (what, value) => { say("evaluated", what); return value; };
const plain = { p: 1, q: 2 };
function conditional(i) { return { a: i, b: i > 1 ? i : 0, c: i, d: i }; }
function first(i) { return { a: i > 1 ? "big" : "small", b: i, c: i }; }
function last(i) { return { a: i, b: i, c: i > 1 ? "big" : "small" }; }
function several(i, o) { return { a: i ?? "none", b: o?.p, c: i || "zero", d: i && "set", e: o?.q?.r ?? "deep", f: i }; }
function ordered(i) { return { a: note("a", i), b: i > 1 ? note("b1", 1) : note("b2", 2), c: note("c", i), d: i ? note("d1", 1) : note("d2", 2) }; }
function nested(i) { return { a: i, inner: { x: i > 1 ? 1 : 2, y: { z: i ? "t" : "f", w: i } }, b: i > 1 ? { k: 1 } : { k: 2, l: 3 }, c: i }; }
function thenSpread(i, r) { return { a: i > 1 ? 1 : 2, ...r, b: i }; }
function spreadOfConditional(i, r) { return { ...(i > 1 ? r : { other: 1 }), b: i }; }
function spreadThenConditional(i, r) { return { ...r, a: i > 1 ? 1 : 2, b: i }; }
function sameName(i) { return { a: 1, b: i > 1 ? 1 : 2, a: 3 }; }
function throwsHalfWay(i) { try { return { a: note("a", i), b: i > 1 ? (() => { throw new RangeError("b"); })() : 0, c: note("c", i) }; } catch (e) { return e.message; } }
function withLoopInValue(i) { return { a: i, b: [1, 2, 3].map(x => x * i), c: (() => { let t = 0; for (let j = 0; j < i; j++) t += j; return t; })(), d: i > 1 ? 1 : 2 }; }
function inLoop(n) { const out = []; for (let i = 0; i < n; i++) out.push({ i, big: i > 1 ? true : false, index: out.length }); return out; }
function madeBeforeLoop(n) { const held = {}; const seen = []; for (let i = 0; i < n; i++) { held["k" + i] = i; seen.push(held); } return [held, seen.every(o => o === held)]; }
function literalBeforeLoop(n) { const held = { start: n > 1 ? 1 : 0 }; for (let i = 0; i < n; i++) held.last = i > 0 ? i : -1; return held; }
function assignedInArms(i) { const o = { a: 1 }; if (i > 1) o.b = 2; else o.c = 3; o.d = 4; return o; }
function usedInValue(i) { const o = { a: i }; const p = { first: o, second: i > 1 ? o : null, third: o.a }; return [p, p.first === o]; }
function selfInClosure(i) { const o = { a: i, get: () => o, b: i > 1 ? 1 : 2 }; return o.get() === o; }
function methodsAndAccessors(i) { return { a: i, m() { return this.a; }, b: i > 1 ? 1 : 2, get g() { return this.b; }, c: i ? 1 : 2 }; }
function computed(i, k) { return { a: i, [k]: i > 1 ? 1 : 2, b: i ? 1 : 2, [k + "2"]: i }; }
function returnedFromArms(i) { return i > 1 ? { a: i, b: i > 2 ? 1 : 2 } : { c: i, d: i ? 1 : 2 }; }
function asArgument(i) { return show({ a: i, b: i > 1 ? [i] : null, c: { d: i ?? 0 } }); }
function withDefault(options) { return { verbose: options?.verbose ?? false, depth: options?.depth || 2, name: options && options.name, tags: options?.tags ? [...options.tags] : [] }; }
function* yields(i) { const made = { a: i, b: yield "first", c: i > 1 ? yield "second" : "none", d: i }; return made; }
async function awaits(i) { return { a: i, b: await (i + 1), c: i > 1 ? await "big" : "small", d: i }; }
function switchValue(i) { let v; switch (i) { case 0: v = "zero"; break; case 1: v = "one"; break; default: v = "many"; } return { a: i, v, w: v === "one" ? 1 : 0 }; }
function tryInValue(i) { return { a: i, b: (() => { try { if (i > 1) throw 1; return "ok"; } catch { return "caught"; } })(), c: i > 1 ? 1 : 2 }; }
for (let i = 0; i < 4; i++) {
  for (const [name, f] of Object.entries({ conditional, first, last, ordered, nested, sameName, throwsHalfWay, withLoopInValue, inLoop, madeBeforeLoop, literalBeforeLoop, assignedInArms, usedInValue, selfInClosure, returnedFromArms, asArgument, switchValue, tryInValue }))
    say(name, i, f(i), Object.keys(Object(f(i))).join());
  say("several", several(i, i > 1 ? plain : null), several(i ? i : null, { q: { r: i } }));
  say("spreads", thenSpread(i, plain), spreadOfConditional(i, plain), spreadThenConditional(i, plain), thenSpread(i, { a: 9, b: 9 }), spreadThenConditional(i, null));
  say("members", (o => [o.m(), o.g, Object.keys(o).join()])(methodsAndAccessors(i)), computed(i, "k"), computed(i, "a"), computed(i, 0));
  const generator = yields(i); say("yields", generator.next().value, generator.next("B").value, generator.next("C").value);
}
say("defaults", withDefault(), withDefault({}), withDefault({ verbose: true, depth: 0, name: "n", tags: ["t"] }), withDefault(null));
say("distinct", conditional(1) !== conditional(1), inLoop(3)[0] !== inLoop(3)[1]);
let sum = 0; for (let i = 0; i < 100000; i++) { const o = conditional(i & 3), s = thenSpread(i & 3, plain), w = withDefault(i & 1 ? { depth: i } : undefined); sum += o.b + o.d + s.a + s.q + w.depth; }
say("sum", sum);
Promise.all([awaits(0), awaits(2)]).then(results => { say("awaits", results); console.log(log.join("\n")); });
