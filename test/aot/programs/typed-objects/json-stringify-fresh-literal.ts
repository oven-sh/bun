// JSON.stringify of a fresh typed object literal is serialized from the values it was created with. Any mutation between the allocation and the call must still be observed.
// SIZE< nested 2000
type Row = { name: string; sides: number; label?: string; next?: Row | undefined };
type Pair = { first: Row; second: Row | null };
function direct(name: string, sides: number): string { return JSON.stringify({ name, sides }); }
function declared(name: string, sides: number): string { const row: Row = { name, sides }; return JSON.stringify(row); }
function withLabel(name: string, sides: number, label: string | undefined): string { const row: Row = { name, sides, label }; return JSON.stringify(row); }
function nested(name: string, sides: number): string { const pair: Pair = { first: { name, sides }, second: null }; return JSON.stringify(pair); }
function nestedTwice(name: string, sides: number): string { return JSON.stringify({ outer: { inner: { name, sides }, sides }, list: [sides, sides + 0.5], flag: sides > 2 }); }
function changed(name: string, sides: number): string { const row: Row = { name, sides }; row.sides = sides + 1; return JSON.stringify(row); }
function grown(name: string, sides: number): string { const row: Row = { name, sides }; row.label = "late"; return JSON.stringify(row); }
function shrunk(name: string, sides: number): string { const row: Row = { name, sides, label: "early" }; delete row.label; return JSON.stringify(row); }
function touch(row: Row): void { row.name = row.name + "!"; }
function handedOn(name: string, sides: number): string { const row: Row = { name, sides }; touch(row); return JSON.stringify(row); }
function held(name: string, sides: number): string { const inner: Row = { name, sides }; const outer: Row = { name: "outer", sides: 0, next: inner }; inner.sides = -1; return JSON.stringify(outer); }
function twice(name: string, sides: number): string { const row: Row = { name, sides }; return JSON.stringify(row) + JSON.stringify(row); }
function inBranch(name: string, sides: number): string { const row: Row = { name, sides }; if (sides > 2) return JSON.stringify(row); row.sides = 0; return JSON.stringify(row); }
function keysInAnotherOrder(name: string, sides: number): string { const row: Row = { sides, label: "l", name }; return JSON.stringify(row); }
function marked(name: string, sides: number): string { const row: Row = { name, sides }; (row as Row & { tag?: number }).tag = 1; return JSON.stringify(row); }
function withToJSON(name: string): string { return JSON.stringify({ name, toJSON() { return "by toJSON " + name; } }); }
function indented(name: string, sides: number): string { return JSON.stringify({ name, sides }, null, 1); }
function undefinedMember(name: string, sides: number): string { const row: Row = { name, next: undefined, sides, label: undefined }; return JSON.stringify(row); }
function onlyUndefinedMembers(_name: string, _sides: number): string { return JSON.stringify({ first: undefined, second: undefined }); }
function sharedInner(name: string, sides: number): string { const inner: Row = { name, sides }; return JSON.stringify({ first: inner, second: inner }); }
let escaped: Row | undefined;
function innerEscapes(name: string, sides: number): string { const inner: Row = { name, sides }; escaped = inner; return JSON.stringify({ inner }) + (escaped === inner); }
function innerReadLater(name: string, sides: number): string { const inner: Row = { name, sides }; const text = JSON.stringify({ inner }); return text + inner.name; }
function threeLevels(name: string, sides: number): string { return JSON.stringify({ a: { b: { name, sides }, sides }, name }); }
function fourLevels(name: string, sides: number): string { return JSON.stringify({ a: { b: { c: { name, sides }, sides }, name }, sides }); }
function outerEscapes(name: string, sides: number): string { const outer = { inner: { name, sides } }; const text = JSON.stringify(outer); return text + outer.inner.sides; }
function siblings(name: string, sides: number): string { return JSON.stringify({ first: { name, sides }, second: { name: name + "2", sides: sides + 1 }, third: { label: name } }); }
function changedBetweenCalls(name: string, sides: number): string { const row: Row = { name, sides }; const before = JSON.stringify(row); row.sides = sides + 1; return before + JSON.stringify(row); }
function innerChangedByClosure(name: string, sides: number): string { const inner: Row = { name, sides }; const outer = { inner }; const bump = (times: number): void => { if (times > 0) { inner.sides += 1; bump(times - 1); } }; bump(2); return JSON.stringify(outer); }
function bumpInside(box: { inner: Row }, times: number): void { if (times > 0) { box.inner.sides += 1; bumpInside(box, times - 1); } }
function innerChangedThroughContainer(name: string, sides: number): string { const inner: Row = { name, sides }; const outer = { inner }; const box = { inner }; bumpInside(box, 2); return JSON.stringify(outer); }
function firstOf(pair: Pair, hops: number): Row { return hops > 0 ? firstOf(pair, hops - 1) : pair.first; }
function innerReturnedByCallee(name: string, sides: number): string { const pair: Pair = { first: { name, sides }, second: null }; firstOf(pair, 1).sides += 1; return JSON.stringify(pair); }
let kept: Row | undefined;
function keepFirst(pair: Pair, hops: number): void { if (hops > 0) keepFirst(pair, hops - 1); else kept = pair.first; }
function bumpKept(): void { if (kept !== undefined) kept.sides += 1; }
function innerKeptByCallee(name: string, sides: number): string { const pair: Pair = { first: { name, sides }, second: null }; keepFirst(pair, 1); bumpKept(); return JSON.stringify(pair); }
const writers: ((name: string, sides: number) => string)[] = [direct, declared, nested, nestedTwice, changed, grown, shrunk, handedOn, held, twice, inBranch, keysInAnotherOrder, marked, indented, undefinedMember, onlyUndefinedMembers, sharedInner, innerEscapes, innerReadLater, threeLevels, fourLevels, outerEscapes, siblings, changedBetweenCalls, innerChangedByClosure, innerChangedThroughContainer, innerReturnedByCallee, innerKeptByCallee];
const names = ["plain", "", 'quo"te', "back\\slash", "line\nbreak", "é世😀", "\ud800", "a".repeat(300)];
const numbers = [0, -0, 1, 3, 2.5, -7, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483648, -2147483649, 4294967295.5];
for (const write of writers) {
  for (const name of names) console.log(write(name, 3));
  for (const sides of numbers) console.log(write("n", sides));
}
for (const label of ["l", "", undefined]) console.log(withLabel("w", 1, label));
console.log(withToJSON("t"));
let total = 0;
for (let round = 0; round < 30000; round++) {
  const write = writers[round % writers.length];
  if (write !== undefined) total += write("r" + (round & 15), round / 4).length;
}
console.log(total);
