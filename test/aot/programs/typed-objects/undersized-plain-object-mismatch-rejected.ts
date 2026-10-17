// A plain object that lacks the room to become a record AND does not satisfy the record's type is refused as before, with the reason.
interface Host { a: () => number; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
function show(h: Host): string { return h.a() + h.c + h.b.length; }
function attempt(name: string, f: () => string): void { try { console.log(name, f()); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n")[1]?.trim().slice(0, 110)); } }
const known: Host = { a: () => 1, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
console.log(show(known));
const kept: any[] = [];
attempt("a required field is missing:", () => { const h: any = { a: () => 7, c: "x" }; kept.push(h); return show(h); });
attempt("a field of another type:", () => { const h: any = { a: () => 8, b: [1], c: 9 }; kept.push(h); return show(h); });
attempt("an optional field of another type:", () => { const h: any = { a: () => 8, b: [1], c: "y", o3: "three" }; kept.push(h); return show(h); });
attempt("what satisfies it:", () => { const h: any = { a: () => 9, b: [1], c: "z" }; kept.push(h); return show(h); });
