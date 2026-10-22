// A property lookup table miss for an own data property, or for an absent name, of an ordinary object is answered from the object's Structure alone. Each of the 1000 objects has its own shape, so every read is a miss.
// The Structure alone cannot answer for a name on another prototype, an own accessor or a name on Object.prototype: those misses take the slow path and get the same answers as in plain Bun.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const misses = () => count("operationAOTGetByIdAndCache");
function make(i) {
  const o = {};
  o["kind" + i] = i;
  o["alpha" + (i % 3)] = 1;
  o.value = i;
  return o;
}
const readValue = o => o.value;
const readMissing = o => (o.missing === undefined ? 1 : 0);
const objects = [];
for (let i = 0; i < 1000; i++) objects.push(make(i));
const before = misses();
let sum = 0;
for (const o of objects) sum += readValue(o);
for (const o of objects) sum += readMissing(o);
const asked = misses() - before;
console.log("1000 shapes, an own and an absent name:", sum, "the reads miss:", typeof aotOperationCount !== "function" || asked >= 1000);

const parent = { missing: 7 };
function makeChild(i) {
  const o = Object.create(parent);
  o["kind" + i] = i;
  return o;
}
function makeWithGetter(i) {
  const o = { get missing() { return i; } };
  o["kind" + i] = i;
  return o;
}
const readName = o => o.missing;
const readToString = o => o.toString;
let others = 0;
for (let i = 0; i < 1000; i++) others += readName(makeChild(i)) + readName(makeWithGetter(i)) + (readToString(objects[i]) === Object.prototype.toString ? 1 : 0);
console.log("1000 shapes, a name on another prototype, an own accessor and a name on Object.prototype:", others);
