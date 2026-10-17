// Object literals written inside `try`: what they hold, what a handler sees when a member's value or a spread throws half way, and that nothing of a literal that was not finished gets out.
const log = [];
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : held);
const say = (...parts) => log.push(parts.map(part => typeof part === "string" ? part : show(part)).join(" "));
function boom(what) { throw new RangeError(what); }
function note(what, value) { say("evaluated", what); return value; }
const plain = { p: 1, q: 2 }, thrower = { a: 1, get b() { throw new RangeError("getter"); }, c: 3 };
function fields(i) { try { return { a: i, b: i + 1, c: "c", d: null }; } catch (e) { return e.message; } }
function fieldsThenCall(i) { try { const made = { a: i, b: i + 1 }; note("behind", 0); return made; } catch (e) { return e.message; } }
function valueThrows(i) { try { return { a: note("a", i), b: boom("b"), c: note("c", i) }; } catch (e) { return e.message; } }
function firstThrows() { try { return { a: boom("a"), b: 2 }; } catch (e) { return e.message; } }
function lastThrows(i) { try { return { a: i, b: 2, c: boom("c") }; } catch (e) { return e.message; } }
function spreadFirst(r, i) { try { return { ...r, a: i, z: 1 }; } catch (e) { return e.message; } }
function spreadLast(r, i) { try { return { a: i, z: 1, ...r }; } catch (e) { return e.message; } }
function spreadBetween(r, i) { try { return { a: i, ...r, z: note("z", 1) }; } catch (e) { return e.message; } }
function twoSpreads(r, s) { try { return { ...r, ...s }; } catch (e) { return e.message; } }
function copy(r) { try { return { ...r }; } catch (e) { return e.message; } }
function heldByVar(r) { try { var made = { a: 1 }; made = { b: 2, ...r }; return made; } catch (e) { return [e.message, made]; } }
function namedThenAssigned(r) { var made; try { made = {}; Object.assign(made, r); return made; } catch (e) { return [e.message, made]; } }
function namedInTry(r) { try { var made = {}; Object.assign(made, r); return made; } catch (e) { return [e.message, made]; } }
function literalThenAssign(r) { try { var made = { first: 1 }; Object.assign(made, r); return made; } catch (e) { return [e.message, made]; } }
function withFinally(r, i) { let state = "start"; try { state = { a: i, ...r, b: 2 }; return state; } catch (e) { return [e.message, state]; } finally { say("finally", typeof state); } }
function nested(r, i) { try { return { outer: { inner: { a: i, ...r }, b: 2 }, c: 3 }; } catch (e) { return e.message; } }
function nestedTry(r, i) { try { try { return { a: i, ...r }; } catch (e) { return { caught: e.message, again: { ...r } }; } } catch (e) { return "outer " + e.message; } }
function computed(k, i) { try { return { a: i, [k]: i, c: i }; } catch (e) { return e.message; } }
function computedThrows(i) { try { return { a: i, [{ toString() { throw new RangeError("key"); } }]: i, c: note("c", i) }; } catch (e) { return e.message; } }
function accessors(i) { try { return { a: i, get b() { return this.a + 1; }, set b(v) { this.a = v; }, c: i }; } catch (e) { return e.message; } }
function methods(i) { try { return { a: i, m() { return this.a; }, n: () => i, c: i }; } catch (e) { return e.message; } }
function proto(p, i) { try { return { __proto__: p, a: i, b: i }; } catch (e) { return e.message; } }
function protoName(i) { try { return { ["__proto__"]: i, a: i }; } catch (e) { return e.message; } }
function indices(i) { try { return { 0: i, 1: i, a: i, 2: i }; } catch (e) { return e.message; } }
function sameNameTwice(i) { try { return { a: i, b: i, a: i + 1 }; } catch (e) { return e.message; } }
function inLoop(n) { const out = []; for (let i = 0; i < n; i++) { try { out.push({ i, twice: i * 2, ...(i === 1 ? thrower : plain) }); } catch (e) { out.push(e.message); } } return out; }
function asArgument(i) { try { return show({ a: i, b: [i], c: { d: i } }); } catch (e) { return e.message; } }
function thrownLiteral(i) { try { throw { a: i, b: i + 1 }; } catch (e) { return e; } }
async function inAsync(r, i) { try { await i; return { a: i, ...r, b: await (i + 1) }; } catch (e) { return e.message; } }
function* inGenerator(r, i) { try { yield { a: i, ...r }; yield { b: yield "ask", c: i }; } catch (e) { yield e.message; } }
for (let i = 0; i < 3; i++) {
  for (const [name, f] of Object.entries({ fields, fieldsThenCall, valueThrows, firstThrows, lastThrows, computedThrows, accessors, methods, protoName, indices, sameNameTwice, asArgument, thrownLiteral }))
    say(name, f(i), Object.keys(Object(f(i))).join());
  for (const source of [plain, thrower, null, undefined, 5, "ab", [7, 8], new Proxy({ x: 1 }, { ownKeys() { throw new RangeError("trap"); } })])
    for (const [name, f] of Object.entries({ spreadFirst, spreadLast, spreadBetween, copy, heldByVar, namedThenAssigned, namedInTry, literalThenAssign, withFinally, nested, nestedTry }))
      say(name, f(source, i));
  say("twoSpreads", twoSpreads(plain, thrower), twoSpreads(thrower, plain), twoSpreads(plain, { q: 9, r: 3 }));
  say("computed", computed("k" + i, i), computed("a", i), computed(i, i), computed(Symbol.for("s"), i));
  say("proto", proto({ up: 1 }, i).up, proto(null, i), Object.getPrototypeOf(proto(null, i)), proto(5, i));
}
say("accessors work", (o => (o.b = 10, [o.a, o.b]))(accessors(1)), methods(4).m(), methods(4).n());
say("inLoop", inLoop(3));
const generator = inGenerator(plain, 1); say("generator", generator.next().value, generator.next().value, generator.next("answer").value); say("generator throws", inGenerator(thrower, 1).next().value);
let sum = 0; for (let i = 0; i < 100000; i++) { const made = fields(i), spread = spreadFirst(plain, i), last = spreadLast(plain, i); sum += made.a + made.b + spread.a + spread.q + last.p + last.z; }
say("sum", sum);
Promise.all([inAsync(plain, 1), inAsync(thrower, 2)]).then(results => { say("async", results); console.log(log.join("\n")); });
