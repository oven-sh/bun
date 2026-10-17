const out = [];
const show = v => { try { return typeof v === "symbol" ? "symbol" : v === undefined ? "undefined" : JSON.stringify(v) ?? String(v); } catch (e) { return e.name; } };
const attempt = f => { try { return show(f()); } catch (e) { return e.name; } };
let hook = () => {};
function call() { hook(); }
const kinds = {
  values: () => ["a", "b", "c", "d"],
  made: () => { const a = []; a.push({ id: 1 }); a.push("x"); a.push(null); a.push(4.5); return a; },
  int32s: () => { const a = []; a.push(1); a.push(2); a.push(3); a.push(4); return a; },
  doubles: () => { const a = []; a.push(1.5); a.push(2.5); a.push(3.5); a.push(4.5); return a; },
  sharedInt32s: () => [1, 2, 3, 4],
  sharedDoubles: () => [1.5, 2.5, 3.5, 4.5],
  holes: () => { const a = ["a", , "c", ,]; return a; },
  short: () => ["only"],
  empty: () => [],
  frozen: () => Object.freeze(["f", "g", "h", "i"]),
  sealed: () => Object.seal(["s", "t", "u", "v"]),
  heir: () => { class Mine extends Array {} const a = new Mine(); a.push("h0", "h1", "h2", "h3"); return a; },
  reparented: () => { const a = ["r0", , "r2", "r3"]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: "inherited" }); return a; },
  named: () => { const a = ["n0", "n1", "n2", "n3"]; a.extra = 1; return a; },
  sparse: () => { const a = ["p0"]; a[100000] = "far"; return a; },
  accessor: () => { const a = ["q0", "q1", "q2", "q3"]; Object.defineProperty(a, 1, { get() { return "got"; }, set(v) { this[3] = "set " + v; }, configurable: true }); return a; },
  object: () => ({ 0: "o0", 1: "o1", 2: "o2", 3: "o3", length: 4 }),
  string: () => "wxyz",
  typed: () => new Uint8Array([7, 8, 9, 10]),
  args: () => (function () { return arguments; })("g0", "g1", "g2", "g3"),
  proxy: () => new Proxy(["x0", "x1", "x2", "x3"], { get(t, k) { return typeof k === "string" && k.length === 1 ? "via " + t[k] : t[k]; } }),
  number: () => 5,
  nothing: () => undefined,
  nil: () => null,
};
// Nothing between the accesses.
function reads(a) { return [a[0], a[1], a[2], a[3], a[4], a[-1]]; }
function stores(a, x, y) { a[0] = x; a[1] = y; a[2] = x; return [a[0], a[1], a[2], a[3], a.length]; }
function memo(a, x, y) { let t; if (a[0] !== x || a[1] !== y) { t = { x, y }; a[0] = x; a[1] = y; a[2] = t; } else t = a[2]; return t; }
function beyond(a, x) { a[1] = x; a[6] = x; a[2] = x; return [a[1], a[2], a[5], a[6], a.length]; }
function storesNumbers(a) { a[0] = 1; a[1] = 2.5; a[2] = NaN; a[3] = -0; return [a[0], a[1], a[2], Object.is(a[3], -0)]; }
for (const [name, make] of Object.entries(kinds)) {
  out.push(name + ": reads " + attempt(() => reads(make())) + " stores " + attempt(() => stores(make(), "X", "Y")) + " memo " + attempt(() => { const a = make(); return [memo(a, 1, 2), memo(a, 1, 2) === memo(a, 1, 2), memo(a, 1, 3)]; }) + " beyond " + attempt(() => beyond(make(), "Z")) + " numbers " + attempt(() => storesNumbers(make())));
}
// A call between the accesses changes the array.
function around(a) { const before = a[1]; call(); const after = a[1]; a[2] = "w"; call(); return [before, after, a[2], a[3], a.length]; }
const changes = {
  nothing: a => {}, shrinks: a => { a.length = 1; }, empties: a => { a.length = 0; }, grows: a => { for (let i = 0; i < 40; i++) a.push("g" + i); }, pops: a => { a.pop(); a.pop(); a.pop(); },
  shifts: a => { a.shift(); }, unshifts: a => { a.unshift("u"); }, deletes: a => { delete a[1]; delete a[2]; }, takesDouble: a => { a[1] = 0.5; }, takesString: a => { a[1] = "s"; }, freezes: a => { Object.freeze(a); },
  reparents: a => { Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: "proto1", 2: "proto2" }); delete a[1]; }, definesAccessor: a => { Object.defineProperty(a, 1, { get() { return "getter"; }, configurable: true }); },
  goesSparse: a => { a[200000] = 1; }, sorts: a => { a.reverse(); }, splices: a => { a.splice(0, 2); }, fills: a => { a.fill("f"); }, names: a => { a.extra = 1; },
};
for (const kind of ["values", "made", "int32s", "doubles", "sharedInt32s", "holes"]) {
  const line = [];
  for (const [name, change] of Object.entries(changes)) { const a = kinds[kind](); let n = 0; hook = () => { if (!n++) change(a); }; line.push(name + " " + attempt(() => around(a))); hook = () => { if (n++ === 3) change(a); }; n = 2; const b = kinds[kind](); const keep = b; hook = () => { if (n++ === 3) change(keep); }; line.push(attempt(() => around(b))); }
  out.push("a call " + kind + ": " + line.join(" | "));
}
hook = () => {};
// The same array under two names; a change by name, by delete, by a method, by a getter run from a read by name.
function twoNames(a, b, x) { const first = a[0]; b[0] = x; const second = a[0]; b[9] = x; const third = a[9]; a[1] = x; return [first, second, third, b[1], a.length, b.length]; }
function lengthByName(a) { const first = a[2]; a.length = 1; const second = a[2]; a[2] = "again"; return [first, second, a[2], a.length]; }
function deleted(a) { const first = a[1]; delete a[1]; const second = a[1]; return [first, second, 1 in a]; }
function pushed(a) { const first = a[4]; a.push("p"); const second = a[4]; a.pop(); a.pop(); return [first, second, a[4], a[3], a.length]; }
function getterBetween(a, o) { const first = a[1]; const got = o.trap; const second = a[1]; return [first, got, second, a.length]; }
function setterBetween(a, o) { a[1] = "s1"; o.trap = 1; a[1] = "s2"; return [a[0], a[1], a.length]; }
function coerced(a, o) { const first = a[1]; const text = "" + o; const second = a[1]; return [first, text, second]; }
function compared(a, o) { const first = a[1]; const less = o < 1; const second = a[1]; return [first, less, second]; }
for (const kind of ["values", "made", "int32s", "doubles", "sharedInt32s"]) {
  const make = kinds[kind];
  out.push("names " + kind + ": " + [attempt(() => { const a = make(); return twoNames(a, a, "T"); }), attempt(() => twoNames(make(), make(), "T")), attempt(() => lengthByName(make())), attempt(() => deleted(make())), attempt(() => pushed(make())),
    attempt(() => { const a = make(); return getterBetween(a, { get trap() { a.length = 0; return "sprung"; } }); }), attempt(() => { const a = make(); return setterBetween(a, { set trap(v) { Object.freeze(a); } }); }),
    attempt(() => { const a = make(); return coerced(a, { toString() { a.shift(); return "text"; } }); }), attempt(() => { const a = make(); return compared(a, { valueOf() { a.length = 1; return 0; } }); })].join(" | "));
}
// Ways that meet: only one of them changes the array; a handler; a receiver that changes.
function diamond(a, flag) { const first = a[1]; if (flag) call(); else first + 1; return [first, a[1], a[2]]; }
function handler(a, flag) { let first = a[1], second; try { if (flag) throw new Error("x"); call(); second = a[1]; } catch (e) { call(); second = a[1]; } return [first, second, a[2]]; }
function throwsBetween(a) { const first = a[0]; try { call(); } catch (e) {} return [first, a[1], a[0], a.length]; }
function throwsInside(a) { let r = [a[0]]; try { r.push(a[1]); call(); r.push(a[1]); } catch (e) { r.push(a[1], a[0]); a[0] = "caught"; } r.push(a[0], a[1], a.length); return r; }
function finallyBlock(a) { let r = []; try { r.push(a[0]); call(); r.push(a[0]); } finally { r.push(a[1]); call(); r.push(a[1]); } return r; }
function reassigned(a, b, flag) { let c = a; const first = c[0]; if (flag) c = b; const second = c[0]; c[1] = "c"; return [first, second, a[1], b[1]]; }
function inLoop(list) { const r = []; for (const a of list) { const x = a[0], y = a[1]; a[2] = x; r.push(x, y, a[2], a.length); } return r; }
function afterLoop(a, n) { const first = a[0]; for (let i = 0; i < n; i++) a.push(i); const second = a[0]; a[1] = "after"; return [first, second, a[1], a[6], a.length]; }
function* generator(a) { const first = a[1]; yield first; const second = a[1]; yield second; a[1] = "g"; yield a[1]; }
async function asynchronous(a) { const first = a[1]; await null; const second = a[1]; a[2] = "as"; return [first, second, a[2], a.length]; }
function closure(a) { const first = a[1]; const f = () => { a.length = 1; }; f(); return [first, a[1], a.length]; }
function nested(a) { const inner = a[0]; const x = inner[0], y = inner[1]; a[0] = [y, x]; return [x, y, a[0][0], inner[0], a[1]]; }
{ const a = kinds.values(); hook = () => { a.length = 1; };
  out.push("ways: " + [attempt(() => diamond(kinds.values(), false)), attempt(() => diamond(a, true)), attempt(() => { const b = kinds.values(); hook = () => { b.shift(); }; return handler(b, false); }), attempt(() => { const b = kinds.values(); hook = () => { b.shift(); }; return handler(b, true); }),
    attempt(() => { const b = kinds.values(); hook = () => { b.shift(); }; return finallyBlock(b); }), attempt(() => { const b = kinds.values(); hook = () => { b.shift(); throw new Error("x"); }; return throwsBetween(b); }), attempt(() => { const b = kinds.values(); hook = () => { b.length = 1; throw new Error("x"); }; return throwsBetween(b); }), attempt(() => { const b = kinds.doubles(); hook = () => { b.unshift("s"); throw new Error("x"); }; return throwsBetween(b); }), attempt(() => { const b = kinds.values(); hook = () => { b.shift(); throw new Error("x"); }; return throwsInside(b); }), attempt(() => { const b = kinds.int32s(); hook = () => { b.length = 0; throw new Error("x"); }; return throwsInside(b); }), attempt(() => reassigned(["a0", "a1"], ["b0", "b1"], false)), attempt(() => reassigned(["a0", "a1"], ["b0", "b1"], true)), attempt(() => reassigned(["a0", "a1"], "str", true)),
    attempt(() => inLoop([["l0", "l1", "l2"], ["m0"], [], [1, 2, 3], [1.5, 2.5, 3.5], "st"])), attempt(() => afterLoop(["z0", "z1"], 9)), attempt(() => { const b = kinds.values(); const g = generator(b); const r = [g.next().value]; b.shift(); r.push(g.next().value); b.length = 0; r.push(g.next().value, b.length); return r; }),
    attempt(() => closure(kinds.values())), attempt(() => nested([["i0", "i1"], "n1"]))].join(" | ")); hook = () => {}; }
// Old arrays, young values.
function three(a, x, y, z) { a[0] = x; a[1] = y; a[2] = z; }
{ const old = []; for (let i = 0; i < 200; i++) old.push(["", "", "", ""]); if (typeof gc === "function") { gc(); gc(); }
  let wrong = 0; for (let round = 0; round < 50; round++) { for (let i = 0; i < 200; i++) three(old[i], { v: i }, { v: i + 1 }, { v: round }); const junk = []; for (let i = 0; i < 2000; i++) junk.push({ v: -1 }); if (typeof edenGC === "function") edenGC(); for (let i = 0; i < 200; i++) if (old[i][0].v !== i || old[i][1].v !== i + 1 || old[i][2].v !== round) wrong++; }
  out.push("old arrays, young values: " + wrong + " wrong"); }
{ const b = kinds.values(); asynchronous(b).then(r => { out.push("async: " + show(r)); console.log(out.join("\n")); }); b.shift(); }
