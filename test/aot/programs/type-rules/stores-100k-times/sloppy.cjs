function count(f) { const seen = {}; for (let i = 0; i < 100000; i++) { let said; try { said = String(f(i)); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
exports.setSize = function (o, v) { o.size = v; return "stored"; };
exports.setByKey = function (o, k, v) { o[k] = v; return "stored"; };
exports.rows = function (made) {
  const { box } = made;
  return [
    ["JavaScript: a wrong value stored to a field", () => { box().size = "big"; return "stored"; }],
    ["JavaScript: a wrong value stored by key", i => { box()[i & 1 ? "size" : "label"] = i & 1 ? "big" : 5; return "stored"; }],
    ["JavaScript: what fits", i => { box().size = i; return "stored"; }],
    ["JavaScript: a wrong value now and then", i => { box().size = i % 1000 === 999 ? "big" : i; return "stored"; }],
    ["JavaScript: Object.assign of a wrong value", () => { Object.assign(box(), { size: "big" }); return "stored"; }],
    ["JavaScript: Reflect.set of a wrong value", () => Reflect.set(box(), "size", "big")],
    ["JavaScript: a name that is not declared", i => { box().extra = i; return "stored"; }],
    ["JavaScript calls a typed function that stores through any", () => made.throughAny(box(), "big")],
    ["JavaScript calls a typed function that stores what it is given", i => made.typedStore(box(), i % 1000 === 999 ? "big" : i)],
  ].map(([name, f]) => name + ": " + count(f));
};
