// `f(...arguments)` in sloppy code where a direct `eval` assigns to a parameter.
const H = globalThis;
const one = v => Object.is(v, -0) ? "-0" : v === undefined ? "undefined" : typeof v === "function" ? "fn" : typeof v === "symbol" ? "symbol" : typeof v === "string" ? JSON.stringify(v) : v !== null && typeof v === "object" ? (Array.isArray(v) ? "[" + Array.from(v, one).join() + "]" : Object.prototype.toString.call(v) === "[object Arguments]" ? "A(" + Array.prototype.map.call(v, one).join() + ")" : "{" + Object.keys(v).map(k => k + ":" + one(v[k])).join() + "}") : String(v);
const S = a => a === undefined || a === null || typeof a !== "object" ? one(a) : Array.isArray(a) ? a.length + one(a) : one(a);
function say(name, f) { let r; try { r = S(f()); } catch (e) { r = "threw " + e.name; } console.log(name + ": " + r); }
H.id = function (...a) { return a; }; H.K = class { constructor(...a) { this.a = a; } };
H.change = function (x) { x[0] = "changed"; }; H.thrower = function () { throw "thrown"; }; H.nothing = function () {};

function evalAssignsParameter_lit(a) { eval("a = 'eval'"); return [0, ...arguments]; }
function evalAssignsParameter_copy(a) { eval("a = 'eval'"); return [...arguments]; }
function evalAssignsParameter_call(a) { eval("a = 'eval'"); return H.id(0, ...arguments); }
function evalAssignsParameter_new(a) { eval("a = 'eval'"); return new H.K(0, ...arguments).a; }
function evalAssignsParameter_seen(a) { eval("a = 'eval'"); return H.id(...arguments); }
const all = [["evalAssignsParameter_lit", evalAssignsParameter_lit], ["evalAssignsParameter_copy", evalAssignsParameter_copy], ["evalAssignsParameter_call", evalAssignsParameter_call], ["evalAssignsParameter_new", evalAssignsParameter_new], ["evalAssignsParameter_seen", evalAssignsParameter_seen]];

const twelve = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (const [name, f] of all) {
  say(name + " 3", () => f("x", "y", 3)); say(name + " 0", () => f()); say(name + " 1", () => f("x"));
  H.fn = f; say(name + " unknown", () => H.fn("x", "y", 3)); say(name + " apply", () => H.fn.apply(null, ["x", undefined])); say(name + " 12", () => H.fn(...twelve));
}

console.log("done"); module.exports = {};
