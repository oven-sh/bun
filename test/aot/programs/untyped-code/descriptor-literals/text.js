const lines = [];
const show = (title, f) => { let text; try { text = String(f()); } catch (e) { text = "throws " + e.constructor.name; } lines.push(title + ": " + text); };
const spell = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? Object.keys(d).map(n => n + "=" + (typeof d[n] === "function" ? "function" : String(d[n]))).join() : "none"; };
const sites = {
    value(o, v) { Object.defineProperty(o, "a", { value: v }); Object.defineProperty(o, "b", { value: v }); return o; },
    flags(o, v) { Object.defineProperty(o, "a", { value: v, writable: true, enumerable: false, configurable: true }); Object.defineProperty(o, "b", { value: v, writable: false, enumerable: true, configurable: false }); return o; },
    accessors(o, v) { Object.defineProperty(o, "a", { get() { return v; }, set(x) { v = x; }, configurable: true }); Object.defineProperty(o, "b", { get() { return v + 1; }, set(x) { v = x - 1; }, configurable: true }); return o; },
    getterOnly(o, v) { Object.defineProperty(o, "a", { get() { return v; } }); Object.defineProperty(o, "b", { get() { return v; } }); return o; },
    byKey(o, v, k) { Object.defineProperty(o, k, { value: v, enumerable: true }); Object.defineProperty(o, k + k, { value: v, enumerable: true }); return o; },
    flagsOnly(o) { Object.defineProperty(o, "a", { enumerable: false }); Object.defineProperty(o, "b", { enumerable: false }); return o; },
    empty(o) { Object.defineProperty(o, "a", {}); Object.defineProperty(o, "b", {}); return o; },
    both(o, v) { Object.defineProperty(o, "a", { value: v, get() { return v; } }); Object.defineProperty(o, "b", { value: v, get() { return v; } }); return o; },
    flagByValue(o, v, f) { Object.defineProperty(o, "a", { value: v, enumerable: f }); Object.defineProperty(o, "b", { value: v, enumerable: f }); return o; },
    kept(o, v) { const d = { value: v }; Object.defineProperty(o, "a", d); const e = { value: v }; Object.defineProperty(o, "b", e); d.value = "changed"; return [o.a, d.value, e.value].join(); },
    twice(o, v) { const d = { value: v, enumerable: true }; Object.defineProperty(o, "a", d); Object.defineProperty(o, "b", d); return o; },
    other(o, v) { Object.defineProperty(o, "a", { value: v, other: 1 }); Object.defineProperty(o, "b", { value: v, other: 1 }); return o; },
    result(o, v) { return Object.defineProperty(o, "a", { value: v }) === o && Object.defineProperty(o, "b", { value: v }) === o; },
    itself(o) { Object.defineProperty(o, "a", { value: o }); Object.defineProperty(o, "b", { value: o }); return o.a === o && o.b === o; },
    order(o) { const seen = []; Object.defineProperty((seen.push("object"), o), (seen.push("key"), "a"), { value: (seen.push("value"), 1) }); Object.defineProperty((seen.push("object"), o), (seen.push("key"), "b"), { value: (seen.push("value"), 2) }); return seen.join(); },
};
const receivers = {
    plain: () => ({}),
    hasThem: () => ({ a: 1, b: 2 }),
    frozen: () => Object.freeze({ a: 1, b: 2 }),
    notExtensible: () => Object.preventExtensions({}),
    fixed: () => Object.defineProperty(Object.defineProperty({}, "a", { value: 0 }), "b", { value: 0 }),
    array: () => [1, 2],
    functionObject: () => function f() {},
    proxy: () => new Proxy({}, { defineProperty(t, k, d) { lines.push("trap " + String(k) + " " + Object.keys(d).join()); return Reflect.defineProperty(t, k, d); } }),
    text: () => "text",
    nil: () => null,
};
function run() {
  for (const site of Object.keys(sites)) {
    for (const receiver of Object.keys(receivers)) {
        for (let turn = 0; turn < 2; turn++)
            show(site + " on " + receiver + " " + turn, () => { const o = receivers[receiver](); const r = sites[site](o, 7, site === "byKey" ? "k" : turn === 0); return (r === o ? "" : String(r) + " ") + ["a", "b", "k", "kk"].map(k => spell(o, k)).join(" | ") + " keys " + Object.keys(o).join(); });
    }
  }
}
run();
show("accessors work", () => { const o = sites.accessors({}, 1); o.a = 5; const first = [o.a, o.b].join(); o.b = 9; return first + " " + [o.a, o.b].join(); });
show("names of accessors", () => { const o = sites.accessors({}, 1); const d = Object.getOwnPropertyDescriptor(o, "a"); return [d.get.name, d.set.name, d.get.length, d.set.length].join(); });
console.log(lines.join("\n"));
