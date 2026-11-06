// Seeded pairs of values for strict deep equality. Prints one line for each comparison: its answer, then every own
// getter and Proxy trap that ran, in order. deep-equal.test.ts runs this file under Bun and under Node.js and compares
// the two outputs.
//
//   <runtime> deep-equal-differential-fixture.cjs <seed> <pairs>
//
// A value is made from a recipe, so every comparison gets operands of its own. The recipes hold:
//   - plain objects, objects with no prototype or a shared one, class instances, an instance with a string tag;
//   - arrays with holes, elements that are getters, and other keys; typed arrays, Dates and boxed numbers with keys;
//   - functions, and Proxies of them;
//   - string keys, index keys, symbol keys, keys that are not enumerable;
//   - getters that answer the same value or a new one each time, and getters that first delete, add, set or hide a
//     key of their own object, change the length of their own array, or throw;
//   - Proxies with any of the get, getOwnPropertyDescriptor, ownKeys, has and getPrototypeOf traps. A trap passes
//     through, or gives another answer for one key, or throws; an ownKeys trap can reverse the keys or leave one out;
//     a get trap can answer a new function for every key that its target lacks.
// The second value of a pair is the first after up to three changes: another key order, a key or an element added,
// removed, hidden or replaced, a getter in place of a value, a Proxy in place of an object.
//
// Left out, because Bun and Node.js are known to differ there (the tests in deep-equal.test.ts that are expected
// failures on Bun say how):
//   - Map, Set and Error objects;
//   - a value that holds itself;
//   - a getter or a trap that changes the object that holds its own object;
//   - a Symbol.toStringTag that is not a string, on anything but a Proxy.
// The lines leave out the reads of `constructor` and `Symbol.toStringTag` and the getPrototypeOf and has traps, of
// which Bun makes fewer than Node.js, and the reads of `href`, `protocol`, `auth` and `path`, by which Node.js looks
// for a URL.
"use strict";

const util = require("node:util");

const S1 = Symbol("s1");
const S2 = Symbol("s2");
const keyOf = key => (key === "S1" ? S1 : key === "S2" ? S2 : key);
const show = key => (typeof key === "symbol" ? `@${key.description}` : String(key));
const PRIMITIVES = [0, -0, NaN, 1, 2, "x", "", true, null, undefined, 1n];
const OBJECT_KEYS = ["a", "b", "c", "d", "e", "0", "1", "S1", "S2"];
const NAMED_KEYS = ["a", "b", "c", "d", "e", "S1", "S2"];

const sharedPrototype = { inherited: 1 };
class Base {}
class Derived extends Base {}
class Tagged {
  get [Symbol.toStringTag]() {
    return "Tagged";
  }
}

function makeRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = n => Math.floor(next() * n);
  return { int, chance: p => next() < p, pick: list => list[int(list.length)] };
}

// Recipes.

const primitive = random => ({ type: "primitive", index: random.int(PRIMITIVES.length) });

function effect(random, keys) {
  const roll = random.int(10);
  const key = random.pick(keys);
  if (roll < 2) return { does: "delete", key };
  if (roll < 4) return { does: "set", key, index: random.int(PRIMITIVES.length) };
  if (roll < 5) return { does: "hide", key };
  if (roll < 7) return { does: "throw" };
  if (roll < 8) return { does: "push" };
  return { does: "truncate" };
}

function property(random, key, depth, keys) {
  const made = { key, kind: "data", enumerable: !random.chance(0.08), value: value(random, depth) };
  if (random.chance(0.14)) {
    made.kind = "getter";
    if (random.chance(0.45)) made.effect = effect(random, keys);
    if (random.chance(0.15)) made.fresh = true;
  }
  return made;
}

function properties(random, depth, keys, most) {
  const pool = keys.slice();
  const made = [];
  for (let count = random.int(most + 1); count > 0 && pool.length > 0; count--)
    made.push(property(random, pool.splice(random.int(pool.length), 1)[0], depth, keys));
  return made;
}

function container(random, depth) {
  const roll = random.int(100);
  if (roll < 50)
    return {
      type: "object",
      prototype: random.pick([
        "Object",
        "Object",
        "Object",
        "Object",
        "Object",
        "null",
        "shared",
        "Base",
        "Derived",
        "Tagged",
      ]),
      properties: properties(random, depth - 1, OBJECT_KEYS, 5),
    };
  if (roll < 80) {
    const elements = [];
    for (let length = random.int(5); length > 0; length--) {
      const kind = random.int(100);
      if (kind < 12) elements.push({ type: "hole" });
      else if (kind < 20) {
        const getter = { type: "getter", value: value(random, depth - 1) };
        if (random.chance(0.3)) getter.effect = effect(random, NAMED_KEYS);
        elements.push(getter);
      } else elements.push(value(random, depth - 1));
    }
    return {
      type: "array",
      elements,
      properties: random.chance(0.35) ? properties(random, depth - 1, NAMED_KEYS, 3) : [],
    };
  }
  const rest = properties(random, depth - 1, NAMED_KEYS, 2);
  if (roll < 87)
    return { type: "bytes", bytes: [random.int(3), random.int(3)].slice(0, random.int(3)), properties: rest };
  if (roll < 92) return { type: "date", time: random.int(2), properties: rest };
  if (roll < 96) return { type: "number", number: random.pick([1, 2]), properties: rest };
  return { type: "function", properties: rest };
}

function proxy(random, target) {
  return {
    type: "proxy",
    target,
    get: random.pick([0, 1, 1, 1, 2, 2, 3, 4]),
    getOwnPropertyDescriptor: random.pick([0, 0, 1, 1, 2, 3, 4]),
    ownKeys: random.pick([0, 0, 1, 1, 2, 3]),
    has: random.int(2),
    getPrototypeOf: random.int(2),
    other: { key: random.pick(NAMED_KEYS), index: random.int(PRIMITIVES.length) },
  };
}

function value(random, depth) {
  if (depth <= 0 || random.chance(0.4)) return primitive(random);
  const made = container(random, depth);
  return random.chance(0.12) ? proxy(random, made) : made;
}

// Every recipe inside `recipe` that is no primitive, each with a function that puts another in its place.
function places(recipe, replace, found) {
  if (recipe.type === "getter") return places(recipe.value, made => (recipe.value = made), found);
  if (recipe.type === "primitive" || recipe.type === "hole") return found;
  found.push({ recipe, replace });
  if (recipe.type === "proxy") places(recipe.target, made => (recipe.target = made), found);
  for (const item of recipe.properties ?? []) places(item.value, made => (item.value = made), found);
  (recipe.elements ?? []).forEach((element, i) => places(element, made => (recipe.elements[i] = made), found));
  return found;
}

function change(random, root) {
  const holder = { root };
  const { recipe, replace } = random.pick(places(root, made => (holder.root = made), []));
  const roll = random.int(100);
  if (recipe.type === "proxy") {
    if (roll < 40) replace(recipe.target);
    else if (roll < 70) Object.assign(recipe, proxy(random, recipe.target));
    else recipe.other = { key: random.pick(NAMED_KEYS), index: random.int(PRIMITIVES.length) };
    return holder.root;
  }
  const keys = recipe.type === "object" ? OBJECT_KEYS : NAMED_KEYS;
  const own = recipe.properties;
  if (roll < 22 && own.length > 1) {
    for (let i = own.length - 1; i > 0; i--) {
      const j = random.int(i + 1);
      [own[i], own[j]] = [own[j], own[i]];
    }
  } else if (roll < 38) replace(proxy(random, recipe));
  else if (roll < 48 && own.length > 0) random.pick(own).value = value(random, 1);
  else if (roll < 56 && own.length > 0) {
    const item = random.pick(own);
    item.kind = item.kind === "data" ? "getter" : "data";
    delete item.effect;
  } else if (roll < 61 && own.length > 0) {
    const item = random.pick(own);
    item.enumerable = !item.enumerable;
  } else if (roll < 66 && own.length > 0) own.splice(random.int(own.length), 1);
  else if (roll < 74) {
    const free = keys.filter(key => !own.some(item => item.key === key));
    if (free.length > 0) own.splice(random.int(own.length + 1), 0, property(random, random.pick(free), 1, keys));
  } else if (roll < 90 && recipe.type === "array" && recipe.elements.length > 0) {
    const i = random.int(recipe.elements.length);
    const element = recipe.elements[i];
    const how = random.int(5);
    if (how === 0) recipe.elements[i] = element.type === "hole" ? { type: "primitive", index: 3 } : { type: "hole" };
    else if (how === 1 && element.type !== "hole")
      recipe.elements[i] = element.type === "getter" ? element.value : { type: "getter", value: element };
    else if (how === 2) recipe.elements[i] = value(random, 1);
    else if (how === 3) recipe.elements.push(value(random, 1));
    else recipe.elements.pop();
  } else if (roll < 94 && recipe.type === "object")
    recipe.prototype = random.pick(["Object", "null", "shared", "Base", "Derived", "Tagged"]);
  return holder.root;
}

function pair(seed) {
  const random = makeRandom(seed);
  let first = container(random, 2);
  let second = JSON.parse(JSON.stringify(first));
  for (let changes = random.pick([0, 1, 1, 1, 2, 2, 3]); changes > 0; changes--) second = change(random, second);
  if (random.chance(0.25)) first = change(random, first);
  if (random.chance(0.1)) first = proxy(random, first);
  return { first, second, skipPrototype: random.chance(0.2) };
}

// Values.

function run(self, does, name) {
  const key = keyOf(does.key);
  if (does.does === "delete") Reflect.deleteProperty(self, key);
  else if (does.does === "set") Reflect.set(self, key, PRIMITIVES[does.index]);
  else if (does.does === "hide") {
    if (Object.hasOwn(self, key)) Reflect.defineProperty(self, key, { enumerable: false });
  } else if (does.does === "throw") throw new RangeError(`${name} throws`);
  else if (does.does === "push") {
    if (Array.isArray(self)) self.push(1);
  } else if (Array.isArray(self) && self.length > 0) self.length = self.length - 1;
}

function getter(recipe, name, label, log) {
  const made = recipe.fresh ? undefined : build(recipe.value, name, log);
  return function () {
    log.push(label);
    if (recipe.effect) run(this, recipe.effect, label);
    return recipe.fresh ? build(recipe.value, name, log) : made;
  };
}

function define(object, own, name, log) {
  for (const item of own) {
    const key = keyOf(item.key);
    const inner = `${name}.${show(key)}`;
    try {
      if (item.kind === "getter")
        Object.defineProperty(object, key, {
          get: getter(item, inner, `${name}.getter(${show(key)})`, log),
          enumerable: item.enumerable,
          configurable: true,
        });
      else if (item.enumerable) object[key] = build(item.value, inner, log);
      else
        Object.defineProperty(object, key, {
          value: build(item.value, inner, log),
          writable: true,
          configurable: true,
        });
    } catch {
      // A typed array takes no index key beyond its length.
    }
  }
  return object;
}

function build(recipe, name, log) {
  switch (recipe.type) {
    case "primitive":
      return PRIMITIVES[recipe.index];
    case "object": {
      const object =
        recipe.prototype === "null"
          ? Object.create(null)
          : recipe.prototype === "shared"
            ? Object.create(sharedPrototype)
            : recipe.prototype === "Base"
              ? new Base()
              : recipe.prototype === "Derived"
                ? new Derived()
                : recipe.prototype === "Tagged"
                  ? new Tagged()
                  : {};
      return define(object, recipe.properties, name, log);
    }
    case "array": {
      const array = [];
      const isPlain = recipe.elements.every(element => element.type !== "hole" && element.type !== "getter");
      if (!isPlain) array.length = recipe.elements.length;
      recipe.elements.forEach((element, i) => {
        const inner = `${name}[${i}]`;
        if (element.type === "hole") return;
        if (element.type === "getter")
          Object.defineProperty(array, i, {
            get: getter(element, inner, `${name}.getter(${i})`, log),
            enumerable: true,
            configurable: true,
          });
        else if (isPlain) array.push(build(element, inner, log));
        else array[i] = build(element, inner, log);
      });
      return define(array, recipe.properties, name, log);
    }
    case "bytes":
      return define(new Uint8Array(recipe.bytes), recipe.properties, name, log);
    case "date":
      return define(new Date(recipe.time), recipe.properties, name, log);
    case "number":
      return define(new Number(recipe.number), recipe.properties, name, log);
    case "function":
      return define(function () {}, recipe.properties, name, log);
    case "proxy": {
      const target = build(recipe.target, name, log);
      const otherKey = keyOf(recipe.other.key);
      const handler = {};
      if (recipe.get)
        handler.get = (inner, key, receiver) => {
          log.push(`${name}.get(${show(key)})`);
          if (key === otherKey && recipe.get === 2) return PRIMITIVES[recipe.other.index];
          if (key === otherKey && recipe.get === 3) throw new RangeError(`${name}.get throws`);
          if (recipe.get === 4 && !Reflect.has(inner, key)) return () => {};
          return Reflect.get(inner, key, receiver);
        };
      if (recipe.getOwnPropertyDescriptor)
        handler.getOwnPropertyDescriptor = (inner, key) => {
          log.push(`${name}.getOwnPropertyDescriptor(${show(key)})`);
          const descriptor = Reflect.getOwnPropertyDescriptor(inner, key);
          if (key !== otherKey) return descriptor;
          if (recipe.getOwnPropertyDescriptor === 2)
            return { value: PRIMITIVES[recipe.other.index], writable: true, enumerable: true, configurable: true };
          if (recipe.getOwnPropertyDescriptor === 3) return undefined;
          if (recipe.getOwnPropertyDescriptor === 4 && descriptor) return { ...descriptor, enumerable: false };
          return descriptor;
        };
      if (recipe.ownKeys)
        handler.ownKeys = inner => {
          log.push(`${name}.ownKeys`);
          const keys = Reflect.ownKeys(inner);
          if (recipe.ownKeys === 2) keys.reverse();
          if (recipe.ownKeys === 3 && keys.includes(otherKey)) keys.splice(keys.indexOf(otherKey), 1);
          return keys;
        };
      if (recipe.has)
        handler.has = (inner, key) => {
          log.push(`${name}.has(${show(key)})`);
          return Reflect.has(inner, key);
        };
      if (recipe.getPrototypeOf)
        handler.getPrototypeOf = inner => {
          log.push(`${name}.getPrototypeOf`);
          return Reflect.getPrototypeOf(inner);
        };
      return new Proxy(target, handler);
    }
  }
  throw new Error(`no such recipe: ${recipe.type}`);
}

const isLeftOut = entry =>
  entry.endsWith("(constructor)") ||
  entry.endsWith("(@Symbol.toStringTag)") ||
  entry.endsWith(".getPrototypeOf") ||
  entry.includes(".has(") ||
  /\((href|protocol|auth|path)\)$/.test(entry);

function compare(made, reversed) {
  const log = [];
  const first = build(made.first, "first", log);
  const second = build(made.second, "second", log);
  log.length = 0;
  let answer;
  try {
    const equal = reversed
      ? util.isDeepStrictEqual(second, first, made.skipPrototype)
      : util.isDeepStrictEqual(first, second, made.skipPrototype);
    answer = String(equal);
  } catch (error) {
    // The engines word their own errors differently: only the message of an error from this file is compared.
    answer = `throws ${error?.name}${String(error?.message).endsWith(" throws") ? `: ${error.message}` : ""}`;
  }
  return `${answer} | ${log.filter(entry => !isLeftOut(entry)).join(" ")}`;
}

// Node.js repeats its first comparison that throws, with cycle detection on: that one is not among the pairs.
try {
  util.isDeepStrictEqual(
    {
      get a() {
        throw 1;
      },
    },
    {
      get a() {
        throw 1;
      },
    },
  );
} catch {}

const seed = Number(process.argv[2]);
const pairs = Number(process.argv[3]);
const lines = [];
for (let index = 0; index < pairs; index++) {
  const made = pair(seed + index);
  lines.push(`${index} ${compare(made, false)}`, `${index} reversed ${compare(made, true)}`);
}
process.stdout.write(lines.join("\n") + "\n");
