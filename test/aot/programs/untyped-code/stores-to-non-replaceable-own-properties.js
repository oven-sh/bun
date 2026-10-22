// An own property that lies in the object is read by its place. Where a plain store may not simply replace it (it is not enumerable, or its object is a prototype), the store has a cache beside the place: both are kept as the table by name grows and its rows move.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTPutByIdAndCache") + count("operationAOTGetByIdAndCache");
const makers = [];
for (let kind = 0; kind < 24; kind++) {
  makers.push(seed => {
    const o = { shown: seed, other: seed + 1 };
    for (let i = 0; i <= kind % 6; i++) o["extra" + kind + "x" + i] = i;
    Object.defineProperty(o, "quiet", { value: seed, writable: true, enumerable: false, configurable: true });
    Object.defineProperty(o, "still", { value: seed * 2, writable: true, enumerable: false, configurable: true });
    return o;
  });
}
function bump(o, by) {
  const before = o.quiet + o.still;
  o.quiet = o.quiet + by;
  o.still = o.still - by;
  o.shown = o.shown + 1;
  return before + o.quiet * 3 + o.still * 5 + o.shown;
}
function ask(o) {
  let found = 0;
  if (o.n01 !== undefined) found++; if (o.n02 !== undefined) found++; if (o.n03 !== undefined) found++; if (o.n04 !== undefined) found++;
  if (o.n05 !== undefined) found++; if (o.n06 !== undefined) found++; if (o.n07 !== undefined) found++; if (o.n08 !== undefined) found++;
  if (o.n09 !== undefined) found++; if (o.n10 !== undefined) found++; if (o.n11 !== undefined) found++; if (o.n12 !== undefined) found++;
  if (o.n13 !== undefined) found++; if (o.n14 !== undefined) found++; if (o.n15 !== undefined) found++; if (o.n16 !== undefined) found++;
  if (o.toString !== undefined) found++; if (o.valueOf !== undefined) found++; if (o.other !== undefined) found++; if (o.quiet !== undefined) found++;
  return found;
}
const objects = makers.map((make, kind) => make(kind));
let sum = 0;
const round = by => { for (const o of objects) sum = Math.imul(sum, 31) + bump(o, by) | 0; };
round(1);
for (const o of objects) sum = sum + ask(o) | 0;
round(2);
console.log("24 kinds:", sum, Object.keys(objects[7]).join(), objects[7].quiet, objects[7].still, objects[23].quiet);
for (let i = 0; i < 20; i++) round(i);
let before = visits();
for (let i = 0; i < 200; i++) round(i);
console.log("hidden properties:", sum, "the run time is asked at most a hundred times in 14400 stores:", typeof aotOperationCount !== "function" || visits() - before <= 100);

const parent = { level: 1, tally: 0, label: "parent" };
const children = [Object.create(parent), Object.create(parent)];
children[1].tally = 100;
function tick(p, c) {
  p.tally = p.tally + 1;
  p.level = p.level + c.tally;
  return c.level + c.tally;
}
let ticks = 0;
for (let i = 0; i < 50; i++) ticks = ticks + tick(parent, children[i & 1]) | 0;
before = visits();
for (let i = 0; i < 2000; i++) ticks = ticks + tick(parent, children[i & 1]) | 0;
console.log("a prototype that is stored to:", ticks, parent.tally, parent.level, children[0].tally, children[1].tally, ask(parent), ask(children[0]));
Object.defineProperty(objects[3], "quiet", { get() { return -1; }, set(v) { this.caught = v; }, configurable: true });
const frozen = Object.freeze(makers[4](9));
let refused = "";
try { bump(frozen, 1); } catch (error) { refused = error instanceof TypeError ? "a TypeError" : String(error); }
round(5);
console.log("after a change:", sum, objects[3].caught, objects[3].quiet, refused, frozen.quiet, frozen.shown, objects[4].quiet, objects[5].quiet);
