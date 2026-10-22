// A store by name to globalThis goes through the global proxy to the global object: every kind of read finds the stored value, a read-only property throws, and a number is read back as the number that was stored.
import { edenGC } from "bun:jsc";

const log = [];
const attempt = work => {
  try {
    return String(work());
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};
function put(object, value) {
  object.counter = value;
}
function get(object) {
  return object.counter;
}

globalThis.counter = -1;
let sum = 0;
for (let i = 0; i < 5000; i++) {
  globalThis.counter = i;
  sum += globalThis.counter + counter;
}
log.push("in a loop: " + [sum, globalThis.counter, counter, Reflect.get(globalThis, "counter")].join(" "));

const small = { counter: -1 };
const large = { a: 1, b: 2, c: 3, counter: -1 };
let wrong = 0;
for (let i = 0; i < 5000; i++) {
  put(globalThis, i);
  put(small, i + 1);
  put(large, i + 2);
  if (get(globalThis) !== i || counter !== i || get(small) !== i + 1 || get(large) !== i + 2) wrong++;
}
log.push("one site, three receivers: " + [wrong, counter, small.counter, large.counter].join(" "));

Bun.gc(true);
let lost = 0;
for (let i = 0; i < 100; i++) {
  put(globalThis, { index: i, text: "young " + i });
  edenGC();
  if (counter.index !== i || globalThis.counter.text !== "young " + i) lost++;
}
log.push("young objects in the old global object: " + lost + " lost");

Object.defineProperty(globalThis, "counter", { value: 7, writable: false, configurable: true });
log.push("read-only, direct: " + attempt(() => ((globalThis.counter = 8), "stored")) + " | " + counter);
log.push("read-only, same site: " + attempt(() => (put(globalThis, 9), "stored")) + " | " + counter);
let thrown = 0;
for (let i = 0; i < 1000; i++) {
  try {
    put(globalThis, i);
  } catch (error) {
    if (error instanceof TypeError) thrown++;
  }
  put(small, i);
}
log.push("read-only, in a loop: " + [thrown, counter, small.counter].join(" "));

Object.defineProperty(globalThis, "counter", { value: 11, writable: true, enumerable: true, configurable: true });
put(globalThis, 12);
log.push("writable again: " + [counter, get(globalThis)].join(" "));

const received = [];
Object.defineProperty(globalThis, "counter", { get: () => "from the getter", set: value => received.push(value), configurable: true });
put(globalThis, 13);
globalThis.counter = 14;
log.push("accessor: " + [received.join(","), counter, get(globalThis)].join(" | "));

Object.defineProperty(globalThis, "counter", { get: () => "getter only", set: undefined, configurable: true });
log.push("getter without setter: " + attempt(() => (put(globalThis, 15), "stored")) + " | " + counter);

delete globalThis.counter;
log.push("deleted: " + ["counter" in globalThis, get(globalThis), typeof counter].join(" "));
put(globalThis, 16);
log.push("added again: " + counter + " " + JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "counter")));

function putRatio(object, value) {
  object.ratio = value;
}
for (const [name, holder] of [["globalThis", globalThis], ["object", { ratio: 0 }]]) {
  for (let i = 0; i < 2000; i++) putRatio(holder, i + 0.5);
  const seen = [];
  for (const number of [1, 1.5, -0, 0, 2 ** 31, -(2 ** 31), NaN, Infinity, 1]) {
    putRatio(holder, number);
    const x = holder.ratio;
    seen.push([Object.is(x, number), typeof x, String(x), 1 / x, ["zero", "one"][x]].join(":"));
  }
  log.push("numbers after doubles, " + name + ": " + seen.join(" "));
}
for (let i = 0; i < 2000; i++) globalThis.ratio = i + 0.25;
globalThis.ratio = 1;
log.push("an int32 after doubles: " + [Object.is(ratio, 1), Object.is(globalThis.ratio, 1), ratio === 1, ratio | 0, "ab"[ratio], JSON.stringify({ ratio })].join(" "));

console.log(log.join("\n"));
