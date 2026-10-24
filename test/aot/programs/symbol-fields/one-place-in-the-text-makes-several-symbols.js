// One `Symbol()` in the text runs several times: in a function called twice, in a factory of objects, in a factory of classes, in a recursion, in a generator. Each symbol names a property of its own. Symbol.for gives one symbol however its text is put together.
function mk() { return Symbol("k"); }
const a = mk(), b = mk();
const o = {}; o[a] = 1; o[b] = 2;
console.log(o[a], o[b], a === b, Object.getOwnPropertySymbols(o).length);
function box(v) { const s = Symbol("slot"); const r = { [s]: v, get() { return this[s]; }, key: s }; return r; }
const x = box(1), y = box(2);
console.log(x.get(), y.get(), x[y.key], y[x.key], x.get.call(y), y.get.call(x));
x[y.key] = 9; console.log(x.get(), x[y.key], Object.getOwnPropertySymbols(x).length);
class C { static make() { const t = Symbol("t"); return class { constructor() { this[t] = 1; } has(o) { return t in o; } }; } }
const K1 = C.make(), K2 = C.make(); const k1 = new K1(), k2 = new K2();
console.log(k1.has(k1), k1.has(k2), k2.has(k1), k2.has(k2));
const once = Symbol("once"); const p = { [once]: 5 }; function rd(q) { return q[once]; }
console.log(rd(p), rd({ [Symbol("once")]: 6 }), rd({}), rd({ [once]: 7 }));
function rec(n, acc) { const s = Symbol("r"); acc[s] = n; return n ? rec(n - 1, acc) : acc; }
console.log(Object.getOwnPropertySymbols(rec(3, {})).length);
function* g() { const s = Symbol("g"); yield s; } const s1 = g().next().value, s2 = g().next().value; const h = { [s1]: 1 }; console.log(h[s1], h[s2]);
const kA = Symbol.for("shared"), kB = Symbol.for("sha" + "red"), kC = Symbol.for(["shared"][0]); const z = { [kA]: 1 }; console.log(z[kB], z[kC], kA === kC, Symbol.keyFor(kB));
let t = 0; for (let i = 0; i < 10000; i++) { const u = box(i); t += u.get() + (u[x.key] === undefined ? 1 : 0); } console.log(t);
