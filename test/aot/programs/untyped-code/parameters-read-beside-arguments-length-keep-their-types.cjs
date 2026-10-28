// A sloppy function that only reads `arguments.length` and `arguments[i]` and stores to no parameter reads its parameters like any other function: what goes into a field is that parameter, not any argument or `undefined`.
// IR= 0 pair GetMappedArgument
// IR= 0 sum = TypeTest
// IR= 0 sum = PropGet
function pair(first, second) {
  if (arguments.length !== 2) throw new Error("two arguments");
  return { first: first, second: second };
}
function sum(p) { return p.first + p.second.length; }

const pairs = [];
for (let i = 0; i < 300; i++) pairs.push(pair(i, i & 1 ? "ab" : "abc"));
let total = 0;
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < 300; i++) total += sum(pairs[i]);
}
console.log(total, JSON.stringify(pairs[5]));
try { pair(1); } catch (error) { console.log(error.message); }
