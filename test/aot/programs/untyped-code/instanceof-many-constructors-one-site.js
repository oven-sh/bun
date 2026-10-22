// One `instanceof` site sees many constructors of every kind. The answer never depends on what the site saw before, and it follows every change to a constructor or to what it inherits from.
const lines = [];
const test = (value, constructor) => value instanceof constructor;
function say(what, run) {
  let answer;
  try {
    answer = String(run());
  } catch (error) {
    answer = "threw " + error.constructor.name;
  }
  lines.push(what + ": " + answer);
}
const count = globalThis.aotOperationCount ?? (() => 0);

class Base {
  constructor(id) {
    this.id = id;
  }
}
const classes = [];
for (let n = 0; n < 64; n++) {
  const made = n % 3 === 0 ? class extends Base {} : n % 3 === 1 ? class extends Base { static index = n; } : class { static other = n; static more = n; };
  if (n % 5 === 0) Object.defineProperty(made, "tag" + n, { value: n });
  classes.push(made);
}
const functions = [];
for (let n = 0; n < 32; n++) {
  const made = function (id) {
    this.id = id;
  };
  if (n % 2) made["own" + n] = n;
  functions.push(made);
}
const constructors = [...classes, ...functions];
const objects = constructors.map((made, n) => new made(n));
function matrix() {
  let yes = 0, no = 0;
  for (let i = 0; i < objects.length; i++) {
    for (let k = 0; k < constructors.length; k++) {
      if (test(objects[i], constructors[k])) yes++;
      else no++;
    }
  }
  return yes + " " + no;
}
say("every object against every constructor", matrix);
say("again", matrix);
const before = count("operationAOTInstanceOfAndCache");
for (let turn = 0; turn < 20; turn++) matrix();
say("the runtime is not entered for constructors that were seen", () => count("operationAOTInstanceOfAndCache") - before < 1000);
say("against Base", () => objects.filter(object => test(object, Base)).length);
say("against Object and Function", () => objects.filter(object => test(object, Object)).length + " " + constructors.filter(made => test(made, Function)).length + " " + constructors.filter(made => test(made, Object)).length);

const primitives = [undefined, null, true, 0, 1.5, "text", Symbol.iterator, 10n];
say("primitives", () => primitives.map(value => constructors.filter(made => test(value, made)).length).join());
say("objects without a prototype", () => {
  const bare = Object.create(null);
  return constructors.filter(made => test(bare, made)).length + " " + test(bare, Object) + " " + test(Object.create(bare), Object);
});
say("made by Object.create", () => constructors.filter(made => test(Object.create(made.prototype), made)).length);
say("two levels down", () => constructors.filter(made => test(Object.create(Object.create(made.prototype)), made)).length);

say("a prototype replaced on plain functions", () => {
  const answers = [];
  for (const made of functions.slice(0, 8)) {
    const old = new made(1);
    const former = made.prototype;
    made.prototype = { replaced: true };
    answers.push(test(old, made), test(new made(2), made), test(Object.create(former), made));
    made.prototype = former;
    answers.push(test(old, made));
  }
  return answers.join();
});
say("a prototype that is no object", () => {
  const made = functions[9];
  const old = new made(1);
  const former = made.prototype;
  made.prototype = 5;
  try {
    return test(5, made) + " " + test(old, made);
  } finally {
    made.prototype = former;
  }
});
say("an object's prototype changed", () => {
  const object = new classes[0](1);
  const answers = [test(object, classes[0])];
  Object.setPrototypeOf(object, classes[2].prototype);
  answers.push(test(object, classes[0]), test(object, classes[2]), test(object, Base));
  Object.setPrototypeOf(object, null);
  answers.push(test(object, classes[2]), test(object, Object));
  return answers.join();
});

say("Symbol.hasInstance of its own", () => {
  const answers = [];
  for (const made of [classes[4], classes[5], functions[4], functions[5]]) {
    const object = new made(1);
    answers.push(test(object, made), test(7, made));
    Object.defineProperty(made, Symbol.hasInstance, { value: value => value === 7, configurable: true });
    answers.push(test(object, made), test(7, made));
    delete made[Symbol.hasInstance];
    answers.push(test(object, made), test(7, made));
  }
  return answers.join();
});
say("Symbol.hasInstance on the class above, added late", () => {
  const heirs = classes.filter(made => Object.getPrototypeOf(made) === Base);
  const theirs = heirs.map(made => new made(1));
  const answers = [theirs.filter((object, i) => test(object, heirs[i])).length];
  Object.defineProperty(Base, Symbol.hasInstance, { value: () => false, configurable: true });
  answers.push(theirs.filter((object, i) => test(object, heirs[i])).length, test(theirs[0], Base), objects.filter((object, i) => test(object, constructors[i])).length);
  Object.defineProperty(Base, Symbol.hasInstance, { value: () => true, configurable: true });
  answers.push(theirs.filter((object, i) => test(object, heirs[i])).length, test(1, heirs[0]));
  delete Base[Symbol.hasInstance];
  answers.push(theirs.filter((object, i) => test(object, heirs[i])).length, test(1, heirs[0]));
  return answers.join();
});
say("declared static Symbol.hasInstance", () => {
  class Even {
    static [Symbol.hasInstance](value) {
      return value % 2 === 0;
    }
  }
  class Heir extends Even {}
  return [test(2, Even), test(3, Even), test(new Even(), Even), test(4, Heir), test(new Heir(), Heir)].join();
});
say("many classes with Symbol.hasInstance, their own or inherited", () => {
  const tested = [];
  for (let n = 0; n < 24; n++) {
    const made = class {
      static index = n;
      static [Symbol.hasInstance](value) {
        return value === this.index;
      }
    };
    tested.push(made, class extends made { static index = n + 100; });
  }
  let yes = 0;
  const turn = () => {
    for (let i = 0; i < tested.length; i++) {
      if (test(tested[i].index, tested[i])) yes++;
      if (test(new tested[i](), tested[i])) yes += 1000;
    }
  };
  turn();
  turn();
  const entered = count("operationAOTInstanceOfAndCache");
  for (let i = 0; i < 100; i++) turn();
  const answers = [yes, count("operationAOTInstanceOfAndCache") - entered < 1000];
  tested[0][Symbol.hasInstance] = () => false;
  Object.defineProperty(tested[2], Symbol.hasInstance, { value: () => false });
  yes = 0;
  turn();
  answers.push(yes);
  delete tested[4][Symbol.hasInstance];
  yes = 0;
  turn();
  answers.push(yes);
  return answers.join();
});
say("a getter for Symbol.hasInstance", () => {
  let reads = 0;
  const made = function () {};
  Object.defineProperty(made, Symbol.hasInstance, {
    get() {
      reads++;
      return undefined;
    },
  });
  return test(new made(), made) + " " + test(1, made) + " " + reads;
});
say("Symbol.hasInstance that is not callable", () => {
  const made = function () {};
  Object.defineProperty(made, Symbol.hasInstance, { value: 1 });
  return test({}, made);
});
say("Symbol.hasInstance that throws", () => {
  const made = function () {};
  Object.defineProperty(made, Symbol.hasInstance, {
    value() {
      throw new RangeError("no");
    },
  });
  return test({}, made);
});
say("a truthy answer", () => {
  const made = function () {};
  Object.defineProperty(made, Symbol.hasInstance, { value: () => "yes" });
  return test({}, made) === true;
});
say("an ordinary object with Symbol.hasInstance", () => test(3, { [Symbol.hasInstance]: value => value === 3 }) + " " + test(4, { [Symbol.hasInstance]: value => value === 3 }));

say("a constructor's own prototype chain changed", () => {
  const made = classes[7];
  const object = new made(1);
  const above = Object.getPrototypeOf(made);
  const answers = [test(object, made)];
  Object.setPrototypeOf(made, { [Symbol.hasInstance]: () => false });
  answers.push(test(object, made));
  Object.setPrototypeOf(made, null);
  answers.push(test(object, made), test(1, made));
  Object.setPrototypeOf(made, above);
  answers.push(test(object, made));
  return answers.join();
});
say("the chain above the class above changed", () => {
  const heirs = classes.filter(made => Object.getPrototypeOf(made) === Base);
  const object = new heirs[3](1);
  const answers = [test(object, heirs[3])];
  Object.setPrototypeOf(Base, { [Symbol.hasInstance]: () => false });
  answers.push(test(object, heirs[3]), test(object, Base));
  Object.setPrototypeOf(Base, Function.prototype);
  answers.push(test(object, heirs[3]), test(object, Base));
  return answers.join();
});

say("bound functions", () => {
  const answers = [];
  for (const made of [classes[1], classes[2], functions[1], functions[2]]) {
    const bound = made.bind(null);
    const twice = bound.bind(null, 1);
    const object = new made(1);
    answers.push(test(object, bound), test(object, twice), test({}, bound), test(1, bound), test(new bound(2), made));
  }
  return answers.join();
});
say("a bound function whose target has Symbol.hasInstance", () => {
  const made = function () {};
  Object.defineProperty(made, Symbol.hasInstance, { value: value => value === 9 });
  return test(9, made.bind(null)) + " " + test({}, made.bind(null));
});
say("proxies on the right", () => {
  const log = [];
  const made = classes[10];
  const proxy = new Proxy(made, {
    get(target, key, receiver) {
      log.push(String(key));
      return Reflect.get(target, key, receiver);
    },
  });
  return test(new made(1), proxy) + " " + test({}, proxy) + " " + test(1, proxy) + " " + log.join();
});
say("proxies on the left", () => {
  const log = [];
  const made = classes[11];
  const proxy = new Proxy(new made(1), {
    getPrototypeOf(target) {
      log.push("getPrototypeOf");
      return Reflect.getPrototypeOf(target);
    },
  });
  return test(proxy, made) + " " + test(proxy, classes[12]) + " " + test(Object.create(proxy), made) + " " + log.length;
});
say("a revoked proxy", () => {
  const { proxy, revoke } = Proxy.revocable(function () {}, {});
  revoke();
  return test({}, proxy);
});
for (const [name, right] of [["undefined", undefined], ["null", null], ["a number", 1], ["a string", "s"], ["an object", {}], ["an array", []], ["a symbol", Symbol.iterator]]) {
  say("on the right: " + name, () => test({}, right));
  say("a primitive against " + name, () => test(1, right));
}
say("functions without a prototype", () => {
  const answers = [];
  for (const made of [() => 1, async () => 1, { method() {} }.method, Math.max]) {
    let answer;
    try {
      answer = test(1, made) + "/" + test({}, made);
    } catch (error) {
      answer = error.constructor.name;
    }
    answers.push(answer);
  }
  return answers.join();
});
say("generator and async functions", () => {
  function* generator() {}
  async function* asyncGenerator() {}
  return [test(generator(), generator), test(asyncGenerator(), asyncGenerator), test({}, generator)].join();
});
say("built-in constructors", () => {
  const pairs = [[[], Array], [new Map(), Map], [new Set(), Set], [/x/, RegExp], [new Date(0), Date], [new Error("e"), Error], [new TypeError("e"), Error], [Promise.resolve(), Promise], [new Uint8Array(1), Uint8Array], [() => 1, Function], [new (class extends Array {})(), Array], [new (class extends Map {})(), Map]];
  return pairs.map(([value, made]) => test(value, made) + "" + test(value, Object) + test({}, made)).join();
});
say("every object against every constructor, at the end", matrix);
say("frozen and sealed constructors", () => {
  const frozen = Object.freeze(class extends Base {});
  const sealed = Object.seal(function () {});
  return [test(new frozen(1), frozen), test(new frozen(1), Base), test(new sealed(), sealed), test({}, frozen)].join();
});
say("constructors with very many properties", () => {
  const made = function () {};
  for (let i = 0; i < 300; i++) made["p" + i] = i;
  const object = new made();
  const answers = [test(object, made)];
  for (let i = 0; i < 300; i += 2) delete made["p" + i];
  answers.push(test(object, made), test({}, made));
  return answers.join();
});
console.log(lines.join("\n"));
