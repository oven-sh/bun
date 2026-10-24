// A plain object with fewer properties than an interface has fields is passed as `any` to a parameter of that interface. Any object passes the check at the parameter, and the object stays as it is. A field of another type throws at the first typed read of that field, a missing field reads as undefined, and a field that is never read is never checked.
interface Host { a: () => number; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
function show(h: Host): string { return h.a() + h.c + h.b.length; }
function showThird(h: Host): string { return String(h.o3); }
function attempt(name: string, f: () => string): void { try { console.log(name, f()); } catch (e) { const message = (e as Error).message, note = message.indexOf(" (bun compile checks types"); console.log(name, (e as Error).name + (note < 0 ? "" : ": " + message.slice(0, note))); } }
const known: Host = { a: () => 1, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
console.log(show(known), showThird(known));
const kept: any[] = [];
attempt("a required field is missing:", () => { const h: any = { a: () => 7, c: "x" }; kept.push(h); return show(h); });
attempt("a field of another type:", () => { const h: any = { a: () => 8, b: [1], c: 9 }; kept.push(h); return show(h); });
attempt("an optional field of another type, not read:", () => { const h: any = { a: () => 8, b: [1], c: "y", o3: "three" }; kept.push(h); return show(h); });
attempt("an optional field of another type, read:", () => { const h: any = { a: () => 8, b: [1], c: "y", o3: "three" }; kept.push(h); return showThird(h); });
attempt("what satisfies it:", () => { const h: any = { a: () => 9, b: [1], c: "z" }; kept.push(h); return show(h) + " " + showThird(h); });
console.log("the objects afterwards:", kept.map(h => Object.keys(h).join()).join(" "));
