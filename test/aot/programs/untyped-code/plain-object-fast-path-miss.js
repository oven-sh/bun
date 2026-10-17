// A cache miss in the by-name property table for an own data property, or for a name that is absent, of an ordinary object is answered by one lookup in the object's Structure, before the slower checks for typed objects, module namespaces, lazy closures and the megamorphic cache.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const fast = () => count("operationAOTGetByNameAndCache:ordinary-object-fast-path");
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
const before = fast();
let sum = 0;
for (const o of objects) sum += readValue(o);
for (const o of objects) sum += readMissing(o);
console.log("1000 shapes, an own and an absent name:", sum, "most misses take the fast path:", typeof aotOperationCount !== "function" || fast() - before >= 1000);
