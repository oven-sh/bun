// What `Object.assign({}, record, { .. })` returns is passed to a function that takes the record type.
type Rec = { a: number; b: number; n: { v: number }; bump?: () => void };
const records: Rec[] = [{ a: 1, b: 2, n: { v: 3 } }, { a: 4, b: 5, n: { v: 6 } }];
function remembered(a: number): Rec { return records[a % 2]!; }
const kept = remembered(5);
const made = Object.assign({}, kept, { z: 1 });
function total(each: Rec): number { return each.a + each.b + each.n.v; }
console.log(total(made), made.z, JSON.stringify(made), total(kept));
