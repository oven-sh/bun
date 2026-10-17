function count(f) { const seen = {}; for (let i = 0; i < 100000; i++) { let said; try { said = String(f(i)); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
exports.define = function (o, v) { Object.defineProperty(o, "size", { value: v, writable: true, enumerable: true, configurable: true }); return typeof o.size; };
exports.rows = function (box) {
  return [
    ["JavaScript: Object.defineProperty, all attributes", () => { Object.defineProperty(box(), "size", { value: "big", writable: true, enumerable: true, configurable: true }); return "defined"; }],
    ["JavaScript: Object.defineProperty, the value alone", () => { Object.defineProperty(box(), "size", { value: "big" }); return "defined"; }],
    ["JavaScript: Reflect.defineProperty", () => Reflect.defineProperty(box(), "size", { value: "big" })],
    ["JavaScript: Object.defineProperties", () => { Object.defineProperties(box(), { size: { value: "big" } }); return "defined"; }],
    ["JavaScript: a wrong value now and then", i => { Object.defineProperty(box(), "size", { value: i % 1000 === 999 ? "big" : i }); return "defined"; }],
    ["JavaScript: what fits", i => { Object.defineProperty(box(), "size", { value: i }); return "defined"; }],
    ["JavaScript: a name that is not declared", i => { Object.defineProperty(box(), "extra", { value: "big", writable: true, enumerable: true, configurable: true }); return "defined"; }],
    ["JavaScript: no value", () => { Object.defineProperty(box(), "size", { enumerable: true }); return "defined"; }],
  ].map(([name, f]) => name + ": " + count(f));
};
