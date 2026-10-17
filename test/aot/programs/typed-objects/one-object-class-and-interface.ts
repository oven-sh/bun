// The same two-field object is read through a class type and through an interface type.
class A { b: number; c: string; constructor(b: number, c: string) { this.b = b; this.c = c; } }
interface R { b: number; c: string }
function viaClass(a: A): boolean { return a.b === 123; }
function viaRecord(a: R): boolean { return a.b === 123; }
function viaOptional(a: { b?: number }): boolean { return a.b === 123; }
function viaNullable(a: A | null): boolean { return a !== null && a.b === 123; }
const keep: any = globalThis; keep.fs = [viaClass, viaRecord, viaOptional, viaNullable];
let n = 0; const as: A[] = [], rs: R[] = [];
for (let i = 0; i < 300; i++) { as.push(new A(i, "x")); rs.push({ b: i, c: "y" }); }
for (let i = 0; i < 300; i++) { if (viaClass(as[i]!)) n++; if (viaRecord(rs[i]!)) n++; if (viaOptional(rs[i]!)) n++; if (viaNullable(as[i]!)) n++; }
console.log(n);
