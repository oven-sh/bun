function count(f) { const seen = {}; for (let i = 0; i < 100000; i++) { let said; try { said = String(f(i)); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
exports.rows = function (made) {
  const { box, lit, Box } = made;
  return [
    ["sloppy: store to a method of a built-in prototype", () => { Array.prototype.push = 1; return "stored"; }],
    ["sloppy: store of a new name to a built-in prototype", () => { Array.prototype.extra = 1; return "stored"; }],
    ["sloppy: store to a global function", () => { parseInt = 1; return "stored"; }],
    ["sloppy: delete of a method of a built-in prototype", () => delete Array.prototype.push],
    ["sloppy: delete by key", i => delete Array.prototype[i & 1 ? "push" : "pop"]],
    ["sloppy: store to a method of a class prototype", () => { Box.prototype.get = 1; return "stored"; }],
    ["sloppy: delete of a method of a class prototype", () => delete Box.prototype.get],
    ["sloppy: delete of a required field of an instance", () => delete box().label],
    ["sloppy: delete of a required field of a literal", () => delete lit().a],
    ["sloppy: delete by key of a field", i => delete box()[i & 1 ? "label" : "size"]],
    ["sloppy: an accessor over a field", () => { Object.defineProperty(box(), "label", { get() { return 1; } }); return "defined"; }],
    ["sloppy: freeze of an instance", () => { Object.freeze(box()); return "frozen"; }],
    ["sloppy: another prototype for an instance", () => { Object.setPrototypeOf(box(), {}); return "set"; }],
    ["sloppy: __proto__ of an instance", () => { box().__proto__ = {}; return "set"; }],
    ["sloppy: caller", function f() { return f.caller === null; }],
    ["sloppy: the prototype of a generator function", () => { function* g() {} g.prototype = {}; return "stored"; }],
  ].map(([name, f]) => name + ": " + count(f));
};
