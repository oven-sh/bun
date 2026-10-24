// A plain object literal that something else also holds is handed, as `any`, to a place of a record type with optional fields that the literal does not give. It satisfies the type and stays the object it is: both holders go on seeing one object.
interface Host { a: number[]; b: string; o1?: number; o2?: number; o3?: number; o4?: number }
interface Pair { list: string[]; x?: number; y?: number; z?: number }
function show(h: Host): string { return h.a.length + h.b + (h.o4 ?? "-"); }
function fill(h: Host): void { h.o1 = 1.5; h.o4 = 4.5; }
function showPair(p: Pair): string { return p.list.join() + (p.z ?? "-"); }
function attempt(name: string, f: () => string): void { try { console.log(name, f()); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n")[1]?.trim().slice(0, 110)); } }
const known: Host = { a: [1], b: "k", o1: 1.5, o2: 2.5, o3: 3.5, o4: 4.5 };
const knownPair: Pair = { list: ["l"], x: 0.5, y: 1.5, z: 2.5 };
console.log(show(known), showPair(knownPair));
const kept: any[] = [];
attempt("two names:", () => { const h: any = { a: [1, 2], b: "s" }; kept.push(h); return show(h); });
attempt("later stores are seen:", () => { const h: any = { a: [1, 2], b: "s" }; kept.push(h); const before = show(h); h.b = "t"; return before + " " + show(h); });
attempt("filled by typed code:", () => { const h: any = { a: [], b: "u" }; kept.push(h); fill(h); return show(h) + " " + Object.keys(h).join() + " " + h.o1; });
attempt("in another order:", () => { const h: any = { b: "v", a: [1, 2, 3] }; kept.push(h); return show(h) + " " + Object.keys(h).join(); });
attempt("with an optional one:", () => { const h: any = { a: [1], b: "w", o4: 9.5 }; kept.push(h); return show(h); });
attempt("one name:", () => { const p: any = { list: ["x", "y"] }; kept.push(p); return showPair(p); });
attempt("many:", () => { let out = 0; for (let i = 0; i < 1000; i++) { const h: any = { a: [i], b: "m" }; kept[0] = h; out += show(h).length; } return String(out); });
attempt("the same object:", () => { const h: any = { a: [1], b: "i" }; kept.push(h); const held: Host = h; return String((held as unknown) === kept[kept.length - 1]); });
