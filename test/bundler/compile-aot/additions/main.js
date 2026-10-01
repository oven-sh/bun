// Built-in objects are immutable in ahead-of-time compiled code: what they have cannot be changed. They can still be
// given more, and much depends on what a prototype does not have. Each function runs before, with and after an addition.

function show(label, f) {
  let result;
  try {
    result = JSON.stringify(f(), (key, value) => (value === undefined ? "<undefined>" : value));
  } catch (e) {
    result = "threw " + e;
  }
  console.log(label.padEnd(24), result);
}

async function showAsync(label, f) {
  let result;
  try {
    result = JSON.stringify(await f());
  } catch (e) {
    result = "threw " + e;
  }
  console.log(label.padEnd(24), result);
}

function withAddition(title, object, key, descriptor, cases) {
  const run = when => {
    console.log(`-- ${title}: ${when}`);
    for (const [label, f] of Object.entries(cases)) show(label, f);
  };
  for (let i = 0; i < 3; i++) for (const f of Object.values(cases)) try { f(); } catch {}
  run("before");
  try {
    Object.defineProperty(object, key, { configurable: true, ...("value" in descriptor ? { writable: true } : {}), ...descriptor });
  } catch (e) {
    console.log("not added: " + e);
  }
  run("with");
  delete object[key];
  run("after");
}

const holey = () => [1, , 3];

withAddition("Symbol.isConcatSpreadable", Array.prototype, Symbol.isConcatSpreadable, { value: false }, {
  "a value": () => [1, 2].concat(42),
  "a string": () => [1, 2].concat("x"),
  "an array": () => [1, 2].concat([3]),
  "an object": () => [1, 2].concat({ a: 1 }),
  "two": () => [1, 2].concat(3, [4]),
  "none": () => [1, 2].concat(),
  "of its own": () => {
    const a = [1, 2];
    a[Symbol.isConcatSpreadable] = true;
    return a.concat(3);
  },
});

withAddition("an element", Array.prototype, 1, { value: "inherited" }, {
  "read": () => holey()[1],
  "in": () => 1 in holey(),
  "at": () => holey().at(1),
  "indexOf": () => [holey().indexOf("inherited"), holey().indexOf(undefined), holey().indexOf(3)],
  "lastIndexOf": () => [holey().lastIndexOf("inherited"), holey().lastIndexOf(undefined)],
  "includes": () => [holey().includes("inherited"), holey().includes(undefined), holey().includes(3)],
  "join": () => holey().join("-"),
  "toString": () => String(holey()),
  "slice": () => holey().slice(0),
  "concat": () => holey().concat(4),
  "concat arrays": () => holey().concat(holey()),
  "shift": () => {
    const a = holey();
    return [a.shift(), a];
  },
  "unshift": () => {
    const a = holey();
    a.unshift(0);
    return a;
  },
  "pop": () => {
    const a = [1, ,];
    return [a.pop(), a];
  },
  "splice": () => {
    const a = holey();
    return [a.splice(0, 2), a];
  },
  "reverse": () => holey().reverse(),
  "sort": () => holey().sort(),
  "toSorted": () => holey().toSorted(),
  "toReversed": () => holey().toReversed(),
  "with": () => holey().with(0, 9),
  "flat": () => [holey()].flat(),
  "copyWithin": () => holey().copyWithin(0, 1),
  "forEach": () => {
    const seen = [];
    holey().forEach((value, index) => seen.push([index, value]));
    return seen;
  },
  "map": () => holey().map(value => value),
  "filter": () => holey().filter(() => true),
  "some": () => holey().some(value => value === "inherited"),
  "every": () => holey().every(value => typeof value === "number"),
  "find": () => holey().find(value => typeof value !== "number"),
  "findIndex": () => holey().findIndex(value => value === "inherited"),
  "findLast": () => holey().findLast(value => typeof value !== "number"),
  "reduce": () => holey().reduce((all, value) => all + "," + value, ""),
  "for of": () => {
    const seen = [];
    for (const value of holey()) seen.push(value);
    return seen;
  },
  "for": () => {
    const a = holey();
    const seen = [];
    for (let i = 0; i < a.length; i++) seen.push(a[i]);
    return seen;
  },
  "spread": () => [...holey()],
  "spread among others": () => {
    const a = holey();
    return [0, ...a, 4, ...a];
  },
  "spread in a loop": () => {
    const a = holey();
    let last;
    for (let i = 0; i < 3; i++) last = [i, ...a];
    return last;
  },
  "spread call": () => ((x, y, z) => [x, y, z])(...holey()),
  "spread call among others": () => ((...all) => all)(0, ...holey(), 4),
  "spread new": () => new (class { constructor(...all) { this.all = all; } })(...holey()).all,
  "map, then read": () => {
    const made = holey().map(value => typeof value);
    return [made.length, 1 in made, Object.keys(made)];
  },
  "reduceRight": () => holey().reduceRight((all, value) => all + "," + value, ""),
  "reduce without a start": () => [, 2, 3].reduce((all, value) => all + "," + value),
  "flatMap": () => holey().flatMap(value => [value]),
  "findLastIndex": () => holey().findLastIndex(value => value === "inherited"),
  "arguments": () => Math.max(...[1, , 3].map(() => 1), ...[2, , 4].slice(0, 1)),
  "destructuring": () => {
    const [a, b, c] = holey();
    return [a, b, c];
  },
  "Array.from": () => Array.from(holey()),
  "keys": () => [Object.keys(holey()), [...holey().keys()]],
  "entries": () => [...holey().entries()],
  "JSON": () => JSON.stringify(holey()),
  "apply": () => (function () { return [...arguments]; }).apply(null, holey()),
  "past the end": () => [1][1],
  "typed array": () => new Uint8Array(1)[1],
  "arguments object": () => (function () { return arguments[1]; })(0),
});

// The addition is made by the callback, while the method runs.
for (const [label, run] of Object.entries({
  forEach: (a, f) => a.forEach(f),
  map: (a, f) => a.map(f),
  filter: (a, f) => a.filter(f),
  some: (a, f) => a.some(f),
  every: (a, f) => a.every((...all) => (f(...all), true)),
  reduce: (a, f) => a.reduce((all, ...rest) => f(...rest), 0),
  find: (a, f) => a.find(f),
  "for of": (a, f) => {
    let index = 0;
    for (const value of a) f(value, index++);
  },
})) {
  const trial = adds => {
    const seen = [];
    run([1, , 3], (value, index) => {
      seen.push([index, value]);
      if (adds) Array.prototype[1] = "added meanwhile";
    });
    delete Array.prototype[1];
    return seen;
  };
  for (let i = 0; i < 3; i++) trial(false);
  show("meanwhile: " + label, () => [trial(false), trial(true), trial(false)]);
}

withAddition("-1", Array.prototype, -1, { value: "inherited" }, {
  "read": () => [1][-1],
  "computed": () => {
    const a = [1, 2];
    const seen = [];
    for (let i = 1; i >= -2; i--) seen.push(a[i]);
    return seen;
  },
  "the last": () => {
    const a = [];
    return a[a.length - 1];
  },
  "in": () => -1 in [1],
  "typed array": () => new Uint8Array(1)[-1],
  "string": () => "abc"[-1],
});

withAddition("an element of strings", String.prototype, 5, { value: "inherited" }, {
  "read": () => "abc"[5],
  "within": () => "abc"[1],
  "at": () => "abc".at(5),
  "charAt": () => "abc".charAt(5),
  "in a loop": () => {
    const s = "abc";
    const seen = [];
    for (let i = 3; i < 7; i++) seen.push(s[i]);
    return seen;
  },
});

withAddition("Symbol.toPrimitive", Array.prototype, Symbol.toPrimitive, { value: () => 42 }, {
  "add": () => [1] + 1,
  "template": () => `${[1]}`,
  "number": () => +[1],
  "equals": () => [[1] == 42, [1] == 1, [1] == "1"],
  "less": () => [1] < 2,
  "key": () => ({ 42: "by the symbol", 1: "by toString" })[[1]],
  "String": () => String([1]),
  "concatenation": () => "".concat([1]),
  "multiply": () => [2] * 2,
});

withAddition("Symbol.toPrimitive of strings", String.prototype, Symbol.toPrimitive, { value: () => 42 }, {
  "a string": () => ["s" + 1, `${"s"}`, "s" == 42],
  "a String": () => [new String("s") + 1, `${new String("s")}`, new String("s") == 42, +new String("1")],
});

withAddition("toJSON", Array.prototype, "toJSON", { value: () => "by toJSON" }, {
  "an array": () => JSON.stringify([1]),
  "inside": () => JSON.stringify({ a: [1], b: 2 }),
});
withAddition("toJSON of numbers", Number.prototype, "toJSON", { value: () => "by toJSON" }, {
  "a number": () => JSON.stringify(1),
  "inside": () => JSON.stringify({ a: 1, b: [2], c: "s" }),
});
withAddition("toJSON of strings", String.prototype, "toJSON", { value: () => "by toJSON" }, {
  "a string": () => JSON.stringify("s"),
  "inside": () => JSON.stringify({ a: "s", b: ["t"] }),
});

// A property that nothing had, read from each kind of value.
for (const [name, prototype, make] of [
  ["arrays", Array.prototype, () => []],
  ["strings", String.prototype, () => "s"],
  ["numbers", Number.prototype, () => 5],
  ["booleans", Boolean.prototype, () => true],
  ["functions", Function.prototype, () => () => {}],
  ["maps", Map.prototype, () => new Map()],
  ["sets", Set.prototype, () => new Set()],
  ["promises", Promise.prototype, () => Promise.resolve()],
  ["regular expressions", RegExp.prototype, () => /x/],
  ["dates", Date.prototype, () => new Date(0)],
  ["errors", Error.prototype, () => new Error()],
  ["symbols", Symbol.prototype, () => Symbol.iterator],
  ["objects", Object.prototype, () => ({})],
]) {
  const read = value => value.extra;
  const has = value => (typeof value === "object" || typeof value === "function" ? "extra" in value : "primitive");
  const call = value => value.extraMethod?.();
  withAddition(`a property of ${name}`, prototype, "extra", { value: "added" }, {
    "read": () => read(make()),
    "in": () => has(make()),
  });
  withAddition(`a method of ${name}`, prototype, "extraMethod", { value() { return typeof this; } }, {
    "call": () => call(make()),
  });
}

// A setter that is inherited takes what would have become a property.
{
  let taken = [];
  withAddition("a setter", Array.prototype, "label", { set(value) { taken.push(value); } }, {
    "store": () => {
      taken = [];
      const a = [1];
      a.label = "x";
      return [Object.keys(a), taken];
    },
  });
}

// Of its own: a regular expression whose exec is replaced, an array whose constructor is.
show("exec of its own", () => {
  const test = re => re.test("abc");
  const plain = /b/;
  const changed = /b/;
  for (let i = 0; i < 3; i++) test(plain);
  changed.exec = () => null;
  return [test(plain), test(changed), "abc".replace(changed, "X"), "abc".split(changed), "abc".match(changed), "abc".search(changed)];
});
show("constructor of its own", () => {
  const a = [1, 2];
  a.constructor = { [Symbol.species]: function () { return { marked: true }; } };
  return [a.concat(3).marked, a.slice(0).marked, a.splice(0, 0).marked, a.map(x => x).marked, a.filter(() => true).marked];
});
show("a subclass", () => {
  class Sub extends Array {}
  const s = Sub.from([1, 2]);
  return [s.concat(3), s.slice(0), s.splice(0, 0), s.map(x => x), s.filter(() => true), s.flat()].map(made => made instanceof Sub);
});

// What is awaited is asked for `then`, and what is iterated with `for await` for Symbol.asyncIterator.
const awaitArray = async () => await [1];
const returnArray = async () => [1];
const resolveArray = () => Promise.resolve([1]);
const forAwait = async () => {
  const seen = [];
  for await (const value of [1, 2]) seen.push(value);
  return seen;
};
const asyncCases = { "await": awaitArray, "return": returnArray, "Promise.resolve": resolveArray, "for await": forAwait };
for (let i = 0; i < 3; i++) for (const f of Object.values(asyncCases)) await f();
for (const [label, f] of Object.entries(asyncCases)) await showAsync("before: " + label, f);
Array.prototype.then = function (resolve) { resolve("by then"); };
for (const [label, f] of Object.entries(asyncCases)) await showAsync("then: " + label, f);
delete Array.prototype.then;
Array.prototype[Symbol.asyncIterator] = async function* () { yield "by the symbol"; };
for (const [label, f] of Object.entries(asyncCases)) await showAsync("asyncIterator: " + label, f);
delete Array.prototype[Symbol.asyncIterator];
for (const [label, f] of Object.entries(asyncCases)) await showAsync("after: " + label, f);

// A promise with a `then` of its own.
{
  const awaitIt = async promise => await promise;
  for (let i = 0; i < 3; i++) await awaitIt(Promise.resolve(i));
  const changed = Promise.resolve("its value");
  changed.then = function (resolve) { resolve("by its own then"); };
  await showAsync("then of its own", async () => [await awaitIt(Promise.resolve("its value")), await awaitIt(changed), await Promise.all([changed]), await (async () => changed)()]);
}

// A typed array whose buffer is gone.
show("detached", () => {
  const attempt = f => {
    try {
      return f();
    } catch (e) {
      return String(e);
    }
  };
  const read = (view, index) =>
    [
      () => view[index],
      () => view.length,
      () => view.byteLength,
      () => view.byteOffset,
      () => index in view,
      () => view.at(0),
      () => view.indexOf(7),
      () => view.includes(7),
      () => view.join(),
      () => [...view],
      () => view.subarray(0),
    ].map(attempt);
  const view = new Uint8Array([7, 8]);
  const before = read(view, 0);
  view.buffer.transfer();
  view[0] = 9;
  return [before, read(view, 0)];
});
show("resized", () => {
  const sum = view => {
    let total = 0;
    for (let i = 0; i < view.length; i++) total += view[i];
    return [view.length, total];
  };
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new Uint8Array(buffer).fill(1);
  const seen = [sum(view)];
  buffer.resize(8);
  seen.push(sum(view));
  buffer.resize(2);
  seen.push(sum(view), view[3]);
  return seen;
});

// An element with a setter: every array of the realm changes its ways.
Object.defineProperty(Array.prototype, 2, { configurable: true, set(value) { console.log("the setter got", value); }, get() { return "from the getter"; } });
show("push", () => {
  const a = [1, 2];
  a.push(3);
  return [a.length, a[2], Object.keys(a)];
});
show("store", () => {
  const a = [1, 2];
  a[2] = 3;
  return [a.length, a[2]];
});
show("literal", () => [1, 2, 3]);
show("concat", () => [1, 2].concat(3));
show("map", () => [1, 2, 3].map(x => x * 2));
show("indexOf", () => [1, 2, ,].indexOf("from the getter"));
show("spread", () => [...[1, 2, ,]]);
