// vm.test.ts runs this file with Node.js and with Bun, and the two must print the same.
//
// Each line is one way to store to an index key of globalThis, with an accessor or a Proxy in the way of the store. It
// says what was called, with which `this` or receiver, and what globalThis has under the key afterwards.
//
// The program is a string so that a realm can evaluate it, and so that Bun's transpiler does not drop the "use strict"
// of its functions (https://github.com/oven-sh/bun/issues/14251).
const vm = require("node:vm");

const program = `
(function () {
  const key = 3;
  let events;
  const name = value =>
    value === globalThis
      ? "globalThis"
      : value === undefined
        ? "undefined"
        : typeof value === "object" || typeof value === "function"
          ? "another object"
          : typeof value + " " + String(value);
  const accessor = prefix => ({
    get() {
      "use strict";
      events.push(prefix + "get this=" + name(this));
      return undefined;
    },
    set(value) {
      "use strict";
      events.push(prefix + "set this=" + name(this) + " value=" + name(value));
    },
    configurable: true,
  });
  // An array method stores to its \`this\`. With these elements and this length, one of its stores is to \`key\`.
  const asArray = (global, elements, length) => {
    for (const index in elements) {
      const value = elements[index];
      Object.defineProperty(global, index, { value, writable: true, enumerable: true, configurable: true });
    }
    global.length = length;
    return global;
  };
  const leftOver = () => {
    delete globalThis.length;
    for (let index = 0; index <= key + 1; index++) delete globalThis[index];
  };

  const stores = {
    "global[key] = value": global => { global[key] = "v"; },
    "global[key] = value in strict code": global => { "use strict"; global[key] = "v"; },
    "global[key] += value": global => { global[key] += "v"; },
    "global[key]++": global => { global[key]++; },
    "global[key] ||= value": global => { global[key] ||= "v"; },
    "global[key] ??= value": global => { global[key] ??= "v"; },
    "global[key] &&= value": global => { global[key] &&= "v"; },
    "[global[key]] = [value]": global => { [global[key]] = ["v"]; },
    "[global[key] = value] = []": global => { [global[key] = "v"] = []; },
    "[...global[key]] = [value]": global => { [...global[key]] = ["v"]; },
    "({ a: global[key] } = { a: value })": global => { ({ a: global[key] } = { a: "v" }); },
    "({ ...global[key] } = { a: value })": global => { ({ ...global[key] } = { a: "v" }); },
    "for (global[key] of [value]);": global => { for (global[key] of ["v"]); },
    "for (global[key] in { v: 1 });": global => { for (global[key] in { v: 1 }); },
    "Reflect.set(global, key, value)": global => { Reflect.set(global, key, "v"); },
    "Reflect.set(global, String(key), value)": global => { Reflect.set(global, String(key), "v"); },
    "Reflect.set(global, key, value, global)": global => { Reflect.set(global, key, "v", global); },
    "Reflect.set(global, key, value, {})": global => { Reflect.set(global, key, "v", {}); },
    "Reflect.set(global, key, value, 5)": global => { Reflect.set(global, key, "v", 5); },
    "Reflect.set(an heir of global's prototype, key, value, global)": global => {
      Reflect.set(Object.create(Object.getPrototypeOf(global)), key, "v", global);
    },
    "Object.assign(global, { [key]: value })": global => { Object.assign(global, { [key]: "v" }); },
    "super[key] = value with global as this": global => {
      ({ __proto__: Object.getPrototypeOf(global), store() { super[key] = "v"; } }).store.call(global);
    },
    "Array.prototype.push": global => { Array.prototype.push.call(asArray(global, {}, key), "v"); },
    "Array.prototype.unshift": global => {
      Array.prototype.unshift.call(asArray(global, { [key - 1]: "v" }, key), "w");
    },
    "Array.prototype.fill": global => { Array.prototype.fill.call(asArray(global, {}, key + 1), "v", key); },
    "Array.prototype.splice": global => { Array.prototype.splice.call(asArray(global, {}, key), key, 0, "v"); },
    "Array.prototype.sort": global => {
      Array.prototype.sort.call(asArray(global, { 0: "c", 1: "b", 2: "a" }, key + 1));
    },
    "Array.prototype.reverse": global => { Array.prototype.reverse.call(asArray(global, { 0: "v" }, key + 1)); },
    "Array.prototype.copyWithin": global => {
      Array.prototype.copyWithin.call(asArray(global, { 0: "v" }, key + 1), key, 0, 1);
    },
    "Array.prototype.shift": global => { Array.prototype.shift.call(asArray(global, { [key + 1]: "v" }, key + 2)); },
    "with (global) global[key] = value": global => { with (global) { global[key] = "v"; } },
    "this[key] = value in global code": () => { (0, eval)("this[" + key + "] = 'v'"); },
    "this[key] = value in a function called on global": global => { Function("this[" + key + "] = 'v'").call(global); },
    "a class field, where the parent constructor returns global": global => {
      class Parent { constructor() { return global; } }
      class Child extends Parent { [key] = "v"; }
      new Child();
    },
    "Array.from, where the constructor returns global": global => {
      Array.from.call(function () { return global; }, { length: key + 1, [key]: "v" });
    },
  };

  // Each puts something in the way of the store and returns the function that takes it away again.
  const holders = {
    "an accessor on Object.prototype": () => {
      Object.defineProperty(Object.prototype, key, accessor(""));
      return () => { delete Object.prototype[key]; };
    },
    "an accessor of globalThis": () => {
      Object.defineProperty(globalThis, key, accessor(""));
      return () => {};
    },
    "a Proxy with traps above globalThis": () => {
      const prototype = Object.getPrototypeOf(globalThis);
      Object.setPrototypeOf(globalThis, new Proxy(Object.create(prototype), {
        get(target, property, receiver) {
          if (property === String(key)) events.push("get trap receiver=" + name(receiver));
          return Reflect.get(target, property, receiver);
        },
        set(target, property, value, receiver) {
          if (property === String(key)) {
            events.push("set trap receiver=" + name(receiver) + " value=" + name(value));
          }
          return Reflect.set(target, property, value, receiver);
        },
        has(target, property) {
          if (property === String(key)) events.push("has trap");
          return Reflect.has(target, property);
        },
      }));
      return () => { Object.setPrototypeOf(globalThis, prototype); };
    },
    "a Proxy without traps above globalThis, in front of an accessor": () => {
      const prototype = Object.getPrototypeOf(globalThis);
      const target = Object.create(prototype, { [key]: accessor("behind the Proxy: ") });
      Object.setPrototypeOf(globalThis, new Proxy(target, {}));
      return () => { Object.setPrototypeOf(globalThis, prototype); };
    },
  };

  const lines = [];
  for (const holder in holders) {
    for (const store in stores) {
      events = [];
      let takeAway;
      try {
        takeAway = holders[holder]();
        stores[store](globalThis);
      } catch (error) {
        events.push("threw " + error.constructor.name);
      }
      const own = Object.getOwnPropertyDescriptor(globalThis, key);
      if (own === undefined) events.push("no own property");
      else events.push("value" in own ? "own value=" + name(own.value) : "own accessor");
      takeAway?.();
      leftOver();
      lines.push(holder + " | " + store + " | " + events.join(", "));
    }
  }
  return lines.join("\\n");
})()`;

if (process.argv[2] === "main") console.log((0, eval)(program));
else console.log(vm.runInContext(program, vm.createContext(vm.constants.DONT_CONTEXTIFY)));
