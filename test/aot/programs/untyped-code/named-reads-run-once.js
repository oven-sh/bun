// Reads `x.name` at the top level of a module and in functions that run once: of literals, class instances, classes, functions, arrays, strings, numbers, proxies, getters that throw, undefined and null, inside and outside try blocks.
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}

const literal = { alpha: 1, beta: "two", gamma: [3], delta: { deep: 4 }, epsilon: undefined, zeta: null };
say(literal.alpha, literal.beta, literal.gamma, literal.delta, literal.epsilon, literal.zeta, literal.missing, literal.toString === Object.prototype.toString);
say(literal.delta.deep, literal.gamma.length, literal.beta.length, literal.alpha.toFixed, literal.hasOwnProperty === Object.prototype.hasOwnProperty);

class Shape {
  static kind = "shape";
  static get computed() { return "computed " + this.kind; }
  sides = 0;
  get doubled() { return this.sides * 2; }
  describe() { return "a shape of " + this.sides; }
}
class Square extends Shape {
  sides = 4;
}
const square = new Square();
say(square.sides, square.doubled, square.describe(), square.missing, Square.kind, Square.computed, Square.name, Square.length, typeof Square.prototype, Shape.missing);

function legacy(a, b) { this.a = a; this.b = b; }
legacy.prototype.sum = function () { return this.a + this.b; };
legacy.marker = "on the function";
const made = new legacy(1, 2);
say(made.a, made.b, made.sum(), made.c, legacy.marker, legacy.name, legacy.length, legacy.missing, made.constructor === legacy);

const grown = {};
grown.first = 1;
grown.second = 2;
for (let i = 0; i < 20; ++i) grown["more" + i] = i;
say(grown.first, grown.second, grown.more7, grown.more19, grown.more20);

const trapped = new Proxy({ real: 1 }, { get(target, key) { return key in target ? target[key] : "trapped " + String(key); } });
say(trapped.real, trapped.imagined, trapped.alpha);

const throwing = { get bad() { throw new RangeError("from the getter"); }, good: 1 };
try {
  say(throwing.good);
  say(throwing.bad);
  say("not reached");
} catch (error) {
  say("caught", error.name, error.message, error.missing);
}

let nothing;
const none = null;
for (const attempt of [() => nothing.alpha, () => none.beta, () => literal.epsilon.gamma, () => literal.zeta.delta, () => literal.missing.deeper]) {
  try {
    say(attempt());
  } catch (error) {
    say(error.constructor.name);
  }
}
try {
  say(nothing.alpha);
} catch (error) {
  say("at the top level", error.constructor.name, typeof error.stack);
} finally {
  say("finally", literal.alpha);
}

say((5).alpha, "text".alpha, true.alpha, Symbol.iterator.description, (10n).alpha, "text".length, [1, 2, 3].length, (() => 0).length);
const frozen = Object.freeze({ alpha: "frozen" });
const inherited = Object.create(literal);
const bare = Object.create(null);
bare.alpha = "bare";
say(frozen.alpha, inherited.alpha, inherited.beta, inherited.missing, bare.alpha, bare.toString);
const map = new Map([["k", 1]]);
say(map.size, map.alpha, new Set([1, 2]).size, new Date(0).alpha, /x/g.flags, /x/g.lastIndex, new Error("e").message, new Uint8Array(3).length, new Uint8Array(3).byteLength);

function once() {
  const local = { alpha: "local", nested: { beta: "nested" } };
  return [local.alpha, local.nested.beta, local.gamma, literal.alpha, square.sides, Square.kind, trapped.other, globalThis.undefined, Math.PI > 3, JSON.stringify.name];
}
say(once());
(function () {
  say(this === undefined, literal.beta, arguments.length, arguments.alpha);
})();
console.log(lines.join("\n"));
