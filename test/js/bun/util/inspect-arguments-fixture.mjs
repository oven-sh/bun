// Run by inspect.test.js in a child process: a print that probes every index up to `length`
// does not return for the lengths used here, and the child can be timed out.
import { jscDescribe } from "bun:jsc";
import vm from "node:vm";

const direct = new Function("return arguments");
const scoped = new Function("a", "b", "c", "const f = () => a; return arguments");
// This file is a module, so its own functions are strict.
function cloned() {
  return arguments;
}
const isSloppyArguments = a => "value" in Object.getOwnPropertyDescriptor(a, "callee");
const structureId = a => jscDescribe(a).match(/StructureID: (\d+)/)[1];
console.log(new Set([direct, scoped, cloned].map(args => structureId(args()))).size);

for (const args of [direct, scoped, cloned]) {
  const a = args(1, 2, 3);
  console.log(isSloppyArguments(a));
  a.length = 2 ** 32;
  console.log(a);
  const b = args(1, 2, 3);
  delete b[1];
  b[70] = 70;
  b[4294967294] = "max";
  b.length = 2 ** 50;
  console.log(Bun.inspect({ b }));
  // A hole next to the last index, with index 0 in the same storage as the far element.
  const c = args(1, 2, 3);
  delete c[0];
  c[0] = "zero";
  c[4294967292] = "far";
  c.length = 2 ** 33;
  console.log(c);
}

// The same print for seeded random objects, checked against the text that the own index keys and
// `length` give. A realm whose Object.prototype has an indexed accessor gives its objects the
// slow-put kind of indexed storage.
const slowPutRealm = vm.createContext({});
vm.runInContext("Object.defineProperty(Object.prototype, 9, { set(v) {}, configurable: true });", slowPutRealm);
const kinds = [
  ["direct", direct],
  ["scoped", new Function("a", "b", "c", "d", "e", "const f = () => a + b + c + d + e; return arguments")],
  ["cloned", cloned],
  ["cloned, slow put", vm.runInContext("(function () { 'use strict'; return arguments; })", slowPutRealm)],
  ["direct, slow put", vm.runInContext("(function () { return arguments; })", slowPutRealm)],
];

let seed = Number(process.env.INSPECT_ARGUMENTS_SEED ?? 1);
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const below = n => Math.floor(random() * n);

function expected(a) {
  const length = a.length;
  if (length === 0) return "[]";
  const indexes = Reflect.ownKeys(a)
    .filter(key => typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < Math.min(length, 2 ** 32 - 1))
    .map(Number)
    .sort((x, y) => x - y);
  const parts = [];
  const holes = n => parts.push(n === 1 ? "empty item" : `${n} x empty items`);
  let next = 0;
  for (const index of indexes) {
    if (index > next) holes(index - next);
    parts.push(typeof a[index] === "string" ? JSON.stringify(a[index]) : String(a[index]));
    next = index + 1;
  }
  if (length > next) holes(length - next);
  return `[ ${parts.join(", ")} ]`;
}

const iterations = Number(process.env.INSPECT_ARGUMENTS_ITERATIONS ?? 3000);
let prints = 0;
let mismatches = 0;
for (let iteration = 0; iteration < iterations; iteration++) {
  const [kind, args] = kinds[iteration % kinds.length];
  const count = below(3) === 0 ? 10 + below(30) : below(9);
  const a = args(...Array.from({ length: count }, (_, i) => i));
  const log = [];
  // A few indexes past the arguments. For a sloppy arguments object each is a key of the sparse map.
  const far = below(5);
  let last = count + below(4);
  for (let k = 0; k < far; k++) {
    last += 1 + (below(3) === 0 ? below(4) : below(2) ? below(40) : below(200000));
    a[last] = "k" + last;
    log.push(`set ${last}`);
  }
  // An assignment throws when an earlier step made the index read-only or a getter.
  const attempt = (step, change) => {
    try {
      change();
      log.push(step);
    } catch {}
  };
  for (let k = below(12); k > 0; k--) {
    const index = below(4) === 0 ? below(last + 30) : below(count + far + 6);
    switch (below(8)) {
      case 0:
      case 1:
      case 2:
        attempt(`delete ${index}`, () => delete a[index]);
        break;
      case 3:
        attempt(`set ${index}`, () => (a[index] = "s" + index));
        break;
      case 4: {
        const descriptor = { value: "v" + index, enumerable: !!below(2), writable: !!below(2), configurable: true };
        attempt(`define ${index}`, () => Object.defineProperty(a, index, descriptor));
        break;
      }
      case 5: {
        // A run of holes, often with its last index assigned again: an element in the regular
        // storage that comes before a later argument.
        const end = index + below(far + 8);
        attempt(`delete ${index}..${end}`, () => {
          for (let j = index; j <= end; j++) delete a[j];
        });
        if (below(2)) attempt(`set ${end}`, () => (a[end] = "r" + end));
        break;
      }
      case 6:
        attempt(`set ${index} to a double`, () => (a[index] = 1.5));
        break;
      case 7:
        attempt(`getter ${index}`, () =>
          Object.defineProperty(a, index, { get: () => "g" + index, enumerable: true, configurable: true }),
        );
        break;
    }
  }
  for (const length of [
    undefined,
    below(count + 3),
    last + 1,
    last + 1 + below(5000),
    2 ** 32 + below(100),
    below(last + 100),
  ]) {
    if (length !== undefined) a.length = length;
    const printed = Bun.inspect(a).replace(/\s+/g, " ");
    const wanted = expected(a);
    prints++;
    if (printed !== wanted && mismatches++ < 5) {
      console.log(
        `mismatch: ${kind}, ${count} arguments, length ${a.length}, ${log.join(", ")}\n  printed: ${printed}\n  wanted:  ${wanted}`,
      );
    }
  }
}
console.log(`${prints} prints, ${mismatches} mismatches`);
