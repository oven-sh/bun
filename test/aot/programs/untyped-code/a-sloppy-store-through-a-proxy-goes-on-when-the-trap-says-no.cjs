// In sloppy code a store that the `set` trap of a proxy refuses, or that the target refuses where there is no trap, goes on in silence. What the target may not deny still throws, and so does a trap that is no function.
const log = [];
function attempt(label, work) { let said; try { said = JSON.stringify(work(), (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function " + held.name : typeof held === "symbol" ? String(held) : held); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const told = work => { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message; } };
class Refusing { constructor() { this.stores = 0; } set(target, key, value) { this.stores++; return false; } }
console.log((function () { return this === undefined; })() ? "strict" : "sloppy");
for (let round = 0; round < 3; round++) {
  attempt("a trap that says no", () => [false, 0, "", null, undefined, NaN, 0n].map(answer => told(() => { const proxy = new Proxy({}, { set: () => answer }); proxy.alpha = 1; return "went on"; })));
  attempt("a trap that says yes", () => [true, 1, "no", {}, 1n].map(answer => told(() => { const proxy = new Proxy({}, { set: () => answer }); proxy.alpha = 1; return "went on"; })));
  attempt("a handler of a class that says no", () => { const handler = new Refusing, target = { alpha: 0 }; const proxy = new Proxy(target, handler); proxy.alpha = 1; proxy.beta = 2; return [target, handler.stores]; });
  attempt("what a refused store is worth", () => { const proxy = new Proxy({}, { set: () => false }); return [proxy.alpha = 5, proxy.alpha]; });
  attempt("no trap, a frozen target", () => { const target = Object.freeze({ alpha: 1 }); const proxy = new Proxy(target, {}); proxy.alpha = 2; proxy.beta = 3; return [target, Object.keys(proxy)]; });
  attempt("no trap, a getter alone", () => { const target = { get alpha() { return 1; } }; const proxy = new Proxy(target, {}); proxy.alpha = 2; return proxy.alpha; });
  attempt("no trap, defineProperty says no", () => { const target = { alpha: 1 }; const proxy = new Proxy(target, { defineProperty() { log.push("asked"); return false; } }); proxy.alpha = 2; proxy.beta = 3; return target; });
  attempt("no trap, a setter is called for the proxy", () => { const target = { set alpha(value) { log.push(this === proxy ? "the proxy" : "another", value); } }; const proxy = new Proxy(target, {}); proxy.alpha = 4; return Object.keys(target); });
  attempt("a trap that is no function", () => [1, "text", {}, true].map(trap => told(() => { const proxy = new Proxy({}, { set: trap }); proxy.alpha = 1; return "went on"; })));
  attempt("a fixed value may not be said to change", () => { const target = {}; Object.defineProperty(target, "fixed", { value: 1 }); const proxy = new Proxy(target, { set: () => true }); return [told(() => { proxy.fixed = 2; return "went on"; }), told(() => { proxy.fixed = 1; return "went on"; })]; });
  attempt("a fixed value may be refused", () => { const target = {}; Object.defineProperty(target, "fixed", { value: 1 }); const proxy = new Proxy(target, { set: () => false }); proxy.fixed = 2; return target.fixed; });
  attempt("a literal that is frozen later", () => { const target = { alpha: 1 }; const proxy = new Proxy(target, { set: () => true }); proxy.alpha = 2; Object.freeze(target); return [told(() => { proxy.alpha = 2; return "went on"; }), told(() => { proxy.alpha = 1; return "went on"; })]; });
  attempt("a trap that throws", () => { const proxy = new Proxy({}, { set(target, key) { throw new RangeError("no " + key); } }); proxy.alpha = 1; });
  attempt("an update and a compound store that are refused", () => { const target = { alpha: 1, beta: 2 }; const proxy = new Proxy(target, { set(t, key) { log.push("set " + key); return false; } }); return [proxy.alpha++, ++proxy.alpha, proxy.beta += 5, target]; });
  attempt("a test, as in strict code", () => { const target = { alpha: 1 }; const proxy = new Proxy(target, { has: () => false }); const said = ["alpha" in proxy]; Object.preventExtensions(target); said.push(told(() => "alpha" in proxy)); return said; });
  attempt("with", () => { const proxy = new Proxy({ alpha: 1 }, { has(target, key) { log.push("has " + String(key)); return key in target; }, set(target, key, value) { log.push("set " + key); return false; } }); with (proxy) { alpha = 2; } return proxy.alpha; });
}
const refusing = new Refusing, bottom = { alpha: 1 }, busy = new Proxy(bottom, refusing);
for (let i = 0; i < 30000; i++) { busy.alpha = i; busy.beta = i; }
console.log(refusing.stores, JSON.stringify(bottom));
