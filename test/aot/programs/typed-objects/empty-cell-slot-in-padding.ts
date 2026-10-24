// Only one of two classes has the fields `big` and `inner`, which hold only cells, and hot loops read them through an interface that both classes implement. `Bare` can keep the bytes of those slots empty in its padding, so the read and the `in` test must recognize an empty slot whose representation has no marker for absent. `Taken` has another field in those bytes, which must never be read as `big`.
interface Shape { y: number; big?: bigint; inner?: { n: number } }
class Full implements Shape { y = 1; big = 5n; inner = { n: 7 }; }
class Bare implements Shape { y = 2; }
interface Packed { y: number; big?: bigint }
class PackedFull implements Packed { y = 1; big = 6n; }
class Taken implements Packed { y = 2; other = "s"; }
function sumBig(list: Shape[]): bigint { let sum = 0n; for (const item of list) if (item.big !== undefined) sum += item.big; return sum; }
function sumInner(list: Shape[]): number { let sum = 0; for (const item of list) sum += item.inner ? item.inner.n : -1; return sum; }
function countOwn(list: Shape[]): number { let count = 0; for (const item of list) { if ("big" in item) count++; if ("inner" in item) count++; } return count; }
function sumPackedBig(list: Packed[]): bigint { let sum = 0n; for (const item of list) if (item.big !== undefined) sum += item.big; return sum; }
const shapes: Shape[] = [], packed: Packed[] = [];
for (let i = 0; i < 3000; i++) { shapes.push(i % 3 ? new Full() : new Bare()); packed.push(i % 3 ? new PackedFull() : new Taken()); }
console.log(String(sumBig(shapes)), sumInner(shapes), countOwn(shapes), String(sumPackedBig(packed)));
console.log(String(shapes[0].big), String(shapes[1].big), shapes[0].inner?.n, shapes[1].inner?.n, String(packed[0].big), String(packed[1].big));
export {};
