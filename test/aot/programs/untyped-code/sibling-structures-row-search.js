// Rows of sibling shapes are placed next to each other in the by-name property table, so finding room for a new row takes about one probe of the occupancy bitmap instead of a search through the crowded part of the table.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const probes = () => count("PropertyLookupTable::firstFittingBase");
function make(i) {
  const o = {};
  o["kind" + i] = i;
  o.first = i; o.second = 2; o.third = 3; o.fourth = 4; o.fifth = 5; o.sixth = 6; o.seventh = 7; o.eighth = 8;
  return o;
}
function read(o) { return o.first + o.second * 2 + o.third * 3 + o.fourth * 5 + o.fifth * 7 + o.sixth * 11 + o.seventh * 13 + o.eighth * 17 + (o.ninth === undefined ? 19 : 0); }
const objects = [];
for (let i = 0; i < 3000; i++) objects.push(make(i));
const before = probes();
let sum = 0;
for (const o of objects) sum = sum + read(o) | 0;
const used = probes() - before;
console.log("3000 sibling shapes, nine names each:", sum, "at most two probes per shape:", typeof aotOperationCount !== "function" || (used > 0 && used <= 6000));
for (const o of objects) sum = sum + read(o) | 0;
console.log(sum);
