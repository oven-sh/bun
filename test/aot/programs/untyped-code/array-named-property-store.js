// The first named property stored to an array needs new out-of-line storage around the indexing header, which the stubs do not allocate, so every such store reaches the runtime. The next ones fit in that storage and stay in the stubs. TypeScript's own parser does this for every node array (array.pos = ...).
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTPutByIdAndCache");
function mark(array, i) {
  array.pos = i;
  array.end = i + 1;
  return array;
}
const before = visits();
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const array = mark([], i);
  array.push(i, i + 1);
  sum += array.pos + array.end + array.length + array[1];
}
for (let i = 0; i < 2000; i++) {
  const array = mark(new Array(i % 7).fill(i), i);
  sum += array.pos + array.end + array.length + (array.length ? array[array.length - 1] : 0);
}
console.log("4000 arrays get two named properties:", sum, "nearly all second stores stay out of the runtime:", typeof aotOperationCount !== "function" || visits() - before <= 4100);

const literal = i => mark([1, 2, 3], i);
let fromLiterals = 0;
for (let i = 0; i < 300; i++) {
  const array = literal(i);
  array[0] = i;
  fromLiterals += array.pos + array[0] + array[2] + literal(0)[0];
}
console.log("array literals keep their elements:", fromLiterals);

const doubles = [];
for (let i = 0; i < 300; i++) doubles.push(mark([i + 0.5, i + 1.5], i));
console.log("arrays of doubles:", doubles.reduce((total, array) => total + array[0] + array[1] + array.pos, 0));

let calls = 0;
class Watched extends Array {
  set pos(value) {
    calls += value;
  }
}
for (let i = 0; i < 300; i++) {
  const array = mark(new Watched(), i);
  if (Object.hasOwn(array, "pos") || !Object.hasOwn(array, "end")) throw new Error("the setter was skipped");
}
console.log("a setter on a subclass's prototype is called:", calls);

class Fixed extends Array {}
Object.defineProperty(Fixed.prototype, "pos", { value: -1, writable: false });
let kept = 0;
let thrown = 0;
for (let i = 0; i < 300; i++) {
  const array = new Fixed();
  try {
    mark(array, i);
  } catch (error) {
    thrown += error instanceof TypeError ? 1 : 0;
  }
  kept += array.pos + (Object.hasOwn(array, "pos") ? 1000 : 0);
}
console.log("a read-only property on a subclass's prototype stops the store:", kept, thrown);

let refused = 0;
for (let i = 0; i < 300; i++) {
  const array = Object.preventExtensions([i]);
  try {
    mark(array, i);
  } catch (error) {
    thrown += error instanceof TypeError ? 1 : 0;
  }
  refused += "pos" in array ? 1 : 0;
}
console.log("an array that is not extensible takes none:", refused, thrown);

const sparse = [];
sparse[100000] = 1;
mark(sparse, 7);
console.log("a sparse array:", sparse.pos, sparse.end, sparse.length, sparse[100000]);

class Late extends Array {}
const early = mark(new Late(), 1);
for (let i = 0; i < 300; i++) mark(new Late(), i);
let lateCalls = 0;
Object.defineProperty(Late.prototype, "pos", { set(value) { lateCalls++; }, configurable: true });
for (let i = 0; i < 300; i++) mark(new Late(), i);
console.log("a setter added to the prototype later is called from then on:", lateCalls, early.pos);
