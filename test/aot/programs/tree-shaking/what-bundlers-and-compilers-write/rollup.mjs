function first() { return "first of a frozen namespace"; }
function second() { return "second"; }
var namespace = /*#__PURE__*/ Object.freeze({ __proto__: null, first: first, second: second });
function pick(object, name) { return object[name]; }
export function rollup() { return pick(namespace, "fir" + "st")() + ", " + Object.keys(namespace).map(name => typeof namespace[name]).join(); }
