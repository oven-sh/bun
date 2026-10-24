const out = [];
const show = v => { try { return typeof v === "symbol" ? "symbol" : v === undefined ? "undefined" : JSON.stringify(v) ?? String(v); } catch (e) { return e.name; } };
const attempt = f => { try { return show(f()); } catch (e) { return e.name; } };
let hook = v => v;
function through(v) { return hook(v); }
globalThis.pushers = [
  t => t.push(), (t, a) => t.push(a), (t, a, b) => t.push(a, b), (t, a, b, c) => t.push(a, b, c), (t, a, b, c, d) => t.push(a, b, c, d), (t, a, b, c, d, e) => t.push(a, b, c, d, e),
  (t, a, b, c, d, e, f) => t.push(a, b, c, d, e, f), (t, a, b, c, d, e, f, g) => t.push(a, b, c, d, e, f, g), (t, a, b, c, d, e, f, g, h) => t.push(a, b, c, d, e, f, g, h), (t, a, b, c, d, e, f, g, h, i) => t.push(a, b, c, d, e, f, g, h, i),
];
globalThis.withCall = [(t, a) => t.push(through(a)), (t, a, b, c, d, e) => t.push(a, b, c, through(d), e), (t, a) => { t.push(through(a)); return t.length; }];
const kinds = {
  values: () => { const a = []; a.push("v"); return a; }, empty: () => [], int32s: () => JSON.parse("[1,2]"), doubles: () => JSON.parse("[1.5,2.5]"), undecided: () => new Array(2), holes: () => { const a = ["a", "b", "c"]; delete a[1]; return a; },
  sharedInt32s: () => [1, 2, 3], sharedDoubles: () => [1.5, 2.5], sharedValues: () => ["s", "t"], heir: () => { class Mine extends Array {} const a = new Mine(); a.push("h"); return a; },
  heirWithPush: () => { class Loud extends Array { push(...list) { return "loud " + super.push(...list); } } return new Loud(); }, frozen: () => Object.freeze(["f"]), sealed: () => Object.seal(["s"]), notExtensible: () => Object.preventExtensions(["n"]),
  lengthNotWritable: () => Object.defineProperty(["l"], "length", { writable: false }), ownPush: () => { const a = ["o"]; a.push = function (...list) { return "own " + list.length; }; return a; }, named: () => { const a = ["n"]; a.extra = 1; return a; },
  reparented: () => Object.setPrototypeOf(["r"], { push(...list) { return "proto " + list.length; } }), sparse: () => { const a = ["p"]; a[100000] = 1; return a; }, proxy: () => new Proxy(["x"], {}), long: () => { const a = []; for (let i = 0; i < 70; i++) a.push(i + "s"); return a; },
  arrayLike: () => ({ length: 1, 0: "k", push: Array.prototype.push }), withOwnMethod: () => ({ list: [], push(...list) { this.list.push(...list); return "method " + this.list.length; } }), string: () => "text", number: () => 5, nothing: () => undefined, nil: () => null,
};
const given = ["a", 1, 2.5, null, { o: 1 }, undefined, NaN, -0, "z"];
for (const [name, make] of Object.entries(kinds)) {
  const line = [];
  for (let n = 0; n < globalThis.pushers.length; n++) { const t = make(); line.push(attempt(() => globalThis.pushers[n](t, ...given.slice(0, n))) + ":" + attempt(() => Array.isArray(t) || (t && typeof t === "object") ? [t.length, t[t.length - 1], Object.is(t[t.length - 1], -0)] : t)); }
  out.push(name + ": " + line.join(" "));
}
// Pushed again and again: every length, the contents.
{ let wrong = 0; for (let n = 1; n < globalThis.pushers.length; n++) { const t = []; for (let r = 0; r < 40; r++) { const got = globalThis.pushers[n](t, ...given.slice(0, n).map((v, i) => r * 10 + i)); if (got !== (r + 1) * n || t.length !== got || t[got - 1] !== r * 10 + n - 1 || t[0] !== 0) wrong++; } let sum = 0; for (const v of t) sum += v; out.push("again " + n + ": " + wrong + " " + t.length + " " + sum); } }
// An argument that is a call changes the receiver, or the method, between the read of the method and the call.
for (const [what, change] of Object.entries({ nothing: t => {}, grows: t => { for (let i = 0; i < 20; i++) t[t.length] = "g"; }, shrinks: t => { t.length = 0; }, freezes: t => { Object.freeze(t); }, givesOwnPush: t => { t.push = () => "replaced"; }, reparents: t => { Object.setPrototypeOf(t, { push() { return "reparented"; } }); }, takesDouble: t => { t[0] = 0.5; }, goesSparse: t => { t[90000] = 1; }, throws: t => { throw new RangeError("x"); } })) {
  const line = []; for (const kind of ["values", "int32s", "doubles", "sharedValues", "empty"]) for (let w = 0; w < 3; w++) { const t = kinds[kind](); hook = v => { change(t); return v; }; line.push(attempt(() => globalThis.withCall[w](t, "a", "b", "c", "d", "e")) + ":" + attempt(() => [t.length, t[t.length - 1]])); }
  out.push("the argument " + what + ": " + line.join(" ")); }
hook = v => v;
// By `call` and `apply`.
globalThis.indirect = [(t, a, b) => Array.prototype.push.call(t, a, b), (t, list) => Array.prototype.push.apply(t, list), (t, list) => t.push(...list), (t, a) => [].push.call(t, a)];
out.push("indirect: " + [() => { const t = ["i"]; return [globalThis.indirect[0](t, 1, 2), t]; }, () => { const t = { length: 2 }; return [globalThis.indirect[0](t, 1, 2), t]; }, () => { const t = ["j"]; return [globalThis.indirect[1](t, [1, 2, 3, 4, 5, 6]), t]; }, () => { const t = ["k"]; return [globalThis.indirect[2](t, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), t]; }, () => { const t = {}; return [globalThis.indirect[3](t, "q"), t]; }, () => globalThis.indirect[0](undefined, 1, 2)].map(attempt).join(" | "));
console.log(out.join("\n"));
