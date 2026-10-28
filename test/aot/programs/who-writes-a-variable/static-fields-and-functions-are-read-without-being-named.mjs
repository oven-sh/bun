// Enumeration, copies, descriptors, proxies, heirs and printing read static fields that no operation names, and functions that are only called are looked at as objects.
const out = [];
class A { static hidden = 41; static other = 1; } out.push(Object.values(A).join(), JSON.stringify(Object.getOwnPropertyDescriptors(A).hidden), Reflect.ownKeys(A).join());
class B { static hidden = 42; } out.push({ ...B }.hidden);
class C { static hidden = 43; } for (const k in C) out.push(k, C[k]);
class D { static hidden = 44; } out.push(Object.entries(D)[0][1]);
class E { static hidden = 45; } out.push(Object.assign({}, E).hidden);
class F { static hidden = 46; } class G extends F {} out.push(G.hidden, Reflect.get(G, "hidden"), Object.create(F).hidden);
class H { static hidden = 47; } out.push(new Proxy(H, {}).hidden);
class I { static hidden = 48; } { const { hidden } = I; out.push(hidden); }
class J { static hidden = 49; } out.push(Object.getOwnPropertyDescriptor(J, "hidden").value, "hidden" in J, Object.hasOwn(J, "hidden"), J.hasOwnProperty("hidden"), J.propertyIsEnumerable("hidden"));
class K { static hidden = 50; } console.log(K);
class L { static hidden = 51; static m() { return this.hidden; } } out.push(L.m(), L.m.call({ hidden: 0 }));
class M { static hidden = 52; static get g() { return super.constructor === Function && this.hidden; } } out.push(M.g);
class N { static hidden = 53; } out.push(eval("N.hidden"));
class O { static #p = 54; static read(o) { return o.#p; } static has(o) { return #p in o; } } out.push(O.read(O), O.has(O), O.has({}));
class P { static hidden = 55; } out.push(JSON.stringify(P), JSON.stringify({ P }), JSON.stringify(Object.assign({}, P)));
function onlyCalled() { return 1; } onlyCalled(); out.push(onlyCalled.name, onlyCalled.length, typeof onlyCalled, onlyCalled instanceof Function, String(onlyCalled).length > 0);
function viaCall() { return this; } out.push(viaCall.call(1) + 1, viaCall.apply(2) + 1, viaCall.bind(3)() + 1);
function tagged(s) { return s.raw[0]; } out.push(tagged`t`);
function opt() { return 1; } out.push(opt?.());
function asNew() { this.a = 1; } out.push(new asNew().a, new asNew().constructor === asNew, Object.getPrototypeOf(new asNew()) === asNew.prototype);
let reassigned = () => 1; const callIt = () => reassigned(); reassigned = () => 2; out.push(callIt());
let maybe; const callMaybe = () => maybe?.(); out.push(callMaybe()); maybe = () => 3; out.push(callMaybe());
let written = 1; written = 2; written = 3; out.push(eval("written"));
let unread = { toString() { out.push("effect"); return ""; } }; `${unread}`;
console.log(JSON.stringify(out));
