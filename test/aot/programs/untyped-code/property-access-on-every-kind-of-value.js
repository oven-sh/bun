// Messages for a nullish base and for `in` on a primitive differ between `bun run` and compiled code, so those print the error's name. A nullish base is refused before the key is converted, as ECMAScript says; plain Bun converts the key first.
function show(value) {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object" && value !== null) return "object";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function attempt(label, action, printsMessage) {
  try {
    console.log(`${label}: ${show(action())}`);
  } catch (error) {
    console.log(`${label}: ${error.name}${printsMessage ? `: ${error.message}` : ""}`);
  }
}

class Point {
  x = 1;
  get doubled() {
    return this.x * 2;
  }
}

function loggingProxy() {
  const log = (trap, key) => console.log(`  trap ${trap} ${show(key)}`);
  return new Proxy(
    { x: 1 },
    {
      get(target, key, receiver) {
        log("get", key);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        log("set", key);
        return Reflect.set(target, key, value, receiver);
      },
      has(target, key) {
        log("has", key);
        return Reflect.has(target, key);
      },
      deleteProperty(target, key) {
        log("deleteProperty", key);
        return Reflect.deleteProperty(target, key);
      },
      getOwnPropertyDescriptor(target, key) {
        log("getOwnPropertyDescriptor", key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      defineProperty(target, key, descriptor) {
        log("defineProperty", key);
        return Reflect.defineProperty(target, key, descriptor);
      },
    },
  );
}

const kinds = [
  ["undefined", () => undefined],
  ["null", () => null],
  ["integer", () => 7],
  ["double", () => 1.5],
  ["string", () => "text"],
  ["boolean", () => true],
  ["array", () => [10, 20]],
  ["plain object", () => ({ x: 1, 0: "zero" })],
  ["class instance", () => new Point()],
  ["frozen object", () => Object.freeze({ x: 1, 0: "zero" })],
  ["proxy", loggingProxy],
];

const symbol = Symbol("key");
const keys = [
  ["string", () => "x"],
  ["length", () => "length"],
  ["symbol", () => symbol],
  ["zero", () => 0],
  ["negative zero", () => -0],
  ["two to the 32", () => 2 ** 32],
  ["fraction", () => 1.5],
];

function strictSetName(base, value) {
  "use strict";
  base.x = value;
  return base.x;
}

function sloppySetName(base, value) {
  base.x = value;
  return base.x;
}

function strictSetKey(base, key, value) {
  "use strict";
  base[key] = value;
  return base[key];
}

function sloppySetKey(base, key, value) {
  base[key] = value;
  return base[key];
}

function sloppyDeleteName(base) {
  return delete base.x;
}

function strictDeleteName(base) {
  "use strict";
  return delete base.x;
}

function sloppyDeleteKey(base, key) {
  return delete base[key];
}

function strictDeleteKey(base, key) {
  "use strict";
  return delete base[key];
}

for (const [kind, create] of kinds) {
  const isNullish = create() === undefined || create() === null;
  const printsMessage = !isNullish;
  console.log(`== ${kind}`);
  attempt("get x", () => create().x, printsMessage);
  attempt("get length", () => create().length, printsMessage);
  attempt("get absent", () => create().absent, printsMessage);
  attempt("strict set x", () => strictSetName(create(), 2), printsMessage);
  attempt("sloppy set x", () => sloppySetName(create(), 2), printsMessage);
  attempt("has x", () => "x" in create(), false);
  attempt("sloppy delete x", () => sloppyDeleteName(create()), printsMessage);
  attempt("strict delete x", () => strictDeleteName(create()), printsMessage);
  for (const [keyKind, createKey] of keys) {
    attempt(`get [${keyKind}]`, () => create()[createKey()], printsMessage);
    attempt(`strict set [${keyKind}]`, () => strictSetKey(create(), createKey(), 2), printsMessage);
    attempt(`sloppy set [${keyKind}]`, () => sloppySetKey(create(), createKey(), 2), printsMessage);
    attempt(`has [${keyKind}]`, () => createKey() in create(), false);
    attempt(`sloppy delete [${keyKind}]`, () => sloppyDeleteKey(create(), createKey()), printsMessage);
    attempt(`strict delete [${keyKind}]`, () => strictDeleteKey(create(), createKey()), printsMessage);
  }

  let conversions = 0;
  const countingKey = {
    toString() {
      conversions++;
      return "x";
    },
  };
  attempt("get [counting key]", () => create()[countingKey], printsMessage);
  console.log(`  conversions ${conversions}`);
  attempt("strict set [counting key]", () => strictSetKey(create(), countingKey, 2), printsMessage);
  console.log(`  conversions ${conversions}`);
  attempt("has [counting key]", () => countingKey in create(), false);
  console.log(`  conversions ${conversions}`);
  attempt("sloppy delete [counting key]", () => sloppyDeleteKey(create(), countingKey), printsMessage);
  console.log(`  conversions ${conversions}`);
}

function conversionOrder(label, action) {
  const order = [];
  const key = {
    toString() {
      order.push("toString");
      return "x";
    },
  };
  attempt(label, () => action(key), false);
  console.log(`  order [${order}]`);
}

conversionOrder("null[key]", key => null[key]);
conversionOrder("undefined[key]", key => undefined[key]);
conversionOrder("key in null", key => key in null);
conversionOrder("delete null[key]", key => delete null[key]);

const present = { x: "present", 3: "three" };
console.log(present.x, present["x"], present[3], "x" in present, 3 in present);
console.log(delete present.x, delete present[3], "x" in present, 3 in present);

const [first, second, third = "default"] = [1, , undefined];
console.log(first, second, third);
const [fromString, fromStringSecond] = "ab";
console.log(fromString, fromStringSecond);
