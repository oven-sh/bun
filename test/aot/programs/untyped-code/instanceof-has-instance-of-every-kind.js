// One `instanceof` site sees every kind of Symbol.hasInstance, every kind of result and every kind of bad right-hand side.
const lines = [];
const test = (value, constructor) => value instanceof constructor;
const count = globalThis.aotOperationCount ?? (() => 0);
function attempt(value, constructor) {
  try {
    return String(test(value, constructor));
  } catch (error) {
    return error.constructor.name;
  }
}
function say(what, value, constructor) {
  const answers = [];
  for (let round = 0; round < 3; round++) answers.push(attempt(value, constructor));
  lines.push(what + ": " + answers.join(" "));
}
function withHasInstance(method) {
  const constructor = function () {};
  Object.defineProperty(constructor, Symbol.hasInstance, { value: method, configurable: true });
  return constructor;
}
const isOne = value => value === 1;

class Plain {}
class OwnStatic {
  static [Symbol.hasInstance](value) {
    return value === 1 && this === OwnStatic && arguments.length === 1;
  }
}
class Parent {
  static [Symbol.hasInstance](value) {
    return value === 1 && this === InheritedStatic;
  }
}
class InheritedStatic extends Parent {}
let getterRuns = 0;
const withGetter = function () {};
Object.defineProperty(withGetter, Symbol.hasInstance, {
  get() {
    getterRuns++;
    return isOne;
  },
});
const kinds = {
  default: Plain,
  "own static method": OwnStatic,
  "inherited static method": InheritedStatic,
  "arrow function": withHasInstance(isOne),
  "bound function": withHasInstance(function (value) { return value === this.wanted; }.bind({ wanted: 1 })),
  "host function": withHasInstance(Array.isArray),
  "proxy of a function": withHasInstance(new Proxy(isOne, {})),
  getter: withGetter,
  "undefined method": withHasInstance(undefined),
  "null method": withHasInstance(null),
};
for (const name in kinds) {
  say(name + ", own instance", new kinds[name](), kinds[name]);
  say(name + ", 1", 1, kinds[name]);
  say(name + ", array", [], kinds[name]);
  say(name + ", object", {}, kinds[name]);
}
lines.push("getter runs: " + getterRuns);

for (const result of [1, "x", {}, 0, "", NaN]) say("method answers " + JSON.stringify(result), {}, withHasInstance(() => result));

const plain = new Plain();
const before = count("operationAOTInstanceOfAndCache");
let matches = 0;
for (let round = 0; round < 1000; round++) {
  if (test(plain, Plain)) matches++;
  if (test(1, OwnStatic)) matches++;
}
lines.push("matches: " + matches);
lines.push("the run time is entered at most 10 times: " + (count("operationAOTInstanceOfAndCache") - before <= 10));

say("method is 1", {}, withHasInstance(1));
say("method is an object", {}, withHasInstance({}));
say("constructor is an object", {}, {});
say("constructor is null", {}, null);
say("constructor is 1", {}, 1);
say("constructor is an arrow function, object", {}, () => {});
say("constructor is an arrow function, primitive", 1, () => {});

const primitivePrototype = function () {};
primitivePrototype.prototype = 1;
say("primitive prototype, object", {}, primitivePrototype);
say("primitive prototype, primitive", 1, primitivePrototype);

function Trapped() {}
let trapRuns = 0;
const trapping = new Proxy({}, {
  getPrototypeOf() {
    trapRuns++;
    return Trapped.prototype;
  },
});
lines.push("proxy with a getPrototypeOf trap: " + test(trapping, Trapped) + ", trap runs: " + trapRuns);

say("object without a prototype", Object.create(null), Object);

console.log(lines.join("\n"));
