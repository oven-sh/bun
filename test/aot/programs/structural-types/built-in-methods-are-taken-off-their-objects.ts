function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const list = [3, 1, 2];
const set = new Set([1]);
const map = new Map([["k", 1]]);
const date = new Date(0);
const pattern = /a/;
const word = "word";
const bytes = new Uint8Array([1, 2]);

show("array push", () => {
  const { push } = list;
  return push(4);
});
show("array join", () => {
  const join = list.join;
  return join();
});
show("array slice", () => (0, list.slice)(1));
show("array iterator next", () => {
  const { next } = list[Symbol.iterator]();
  return next();
});
show("set has", () => {
  const { has } = set;
  return has(1);
});
show("set add handed to forEach", () => [5, 6].forEach(set.add));
show("set add handed to forEach with the set", () => {
  [5, 6].forEach(set.add, set);
  return set.size;
});
show("map get", () => {
  const { get } = map;
  return get("k");
});
show("date getTime", () => {
  const { getTime } = date;
  return getTime();
});
show("regexp test", () => ["a", "b"].filter(pattern.test).length);
show("regexp test with the pattern", () => ["a", "b"].filter(pattern.test, pattern).length);
show("string slice", () => {
  const { slice } = word;
  return slice(1);
});
show("string toUpperCase", () => {
  const upper = word.toUpperCase;
  return upper();
});
show("string trim handed to map", () => [" a "].map(word.trim));
show("number toFixed", () => {
  const { toFixed } = 5;
  return toFixed(1);
});
show("typed array subarray", () => {
  const { subarray } = bytes;
  return subarray(1);
});
show("promise then", () => {
  const { then } = Promise.resolve(1);
  return then(() => 1);
});
show("Promise.resolve", () => {
  const { resolve } = Promise;
  return resolve(1);
});
show("Promise.resolve handed to map", () => [1].map(Promise.resolve));
show("Promise.resolve handed to map with Promise", () => typeof [1].map(Promise.resolve, Promise)[0]);

show("Array.from", () => {
  const { from } = Array;
  return from("ab").join();
});
show("Array.of", () => {
  const { of } = Array;
  return of(1, 2).join();
});
show("Array.isArray", () => [[1], 1].map(Array.isArray).join());
show("Object.keys", () => {
  const { keys } = Object;
  return keys({ a: 1 }).join();
});
show("Math.max", () => {
  const { max } = Math;
  return max(1, 2);
});
show("JSON.stringify", () => {
  const { stringify } = JSON;
  return stringify([1]);
});
show("Number.isInteger", () => [1, 1.5].map(Number.isInteger).join());
show("String.fromCharCode", () => {
  const { fromCharCode } = String;
  return fromCharCode(65);
});
show("Symbol.for", () => {
  const make = Symbol.for;
  return make("x") === Symbol.for("x");
});
show("Reflect.ownKeys", () => [{ a: 1 }].map(Reflect.ownKeys).join());
show("array push called on an array-like", () => {
  const target = { length: 0 };
  list.push.call(target, 9);
  return JSON.stringify(target);
});
show("array join called on a string", () => list.join.call("abc", "-"));
show("the list is untouched", () => list.join());
