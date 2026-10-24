// An object of the program is read through its type, then stops fitting that type (a value of another type is stored by name, a property is
// deleted, made an accessor, or left to another prototype), then is read again. The second read answers as the language says, by whichever
// way the object got from the first read to the second. The field that is read again holds a number throughout; the field that holds another kind is not read.
declare const console: { log(...values: unknown[]): void };
declare const globalThis: { kept?: unknown };
declare const JSON: { parse(s: string): any };
declare const Object: { defineProperty(o: any, k: string, d: any): any; setPrototypeOf(o: any, p: any): any };
interface Inner { v: number; w: number }
interface T { a: number; b: number; c: number; d: number; kind: number; ref: Inner; next: T | null; opt?: Inner; flag: boolean; text: string }
function make(i: number): T { return { a: i + 0.5, b: i + 1.5, c: i + 2.5, d: i + 3.5, kind: i, ref: { v: i, w: i + 1 }, next: null, flag: (i & 1) === 0, text: "t" + i } }
const door: T[] = JSON.parse('[{"a":1,"b":2,"c":3,"d":4,"kind":1,"ref":{"v":1,"w":2},"next":null,"flag":true,"text":"s"}]') as T[];
const pool: T[] = [];
for (let i = 0; i < 600; i++) pool.push(make(i));
for (let i = 0; i + 1 < 600; i++) pool[i].next = pool[i + 1];
let taken = 0;
function fresh(): T { taken += 2; return pool[taken]; }
type Spoiler = (x: any) => void;
const nothing: Spoiler = (x) => { };
const misfit: Spoiler = (x) => { x.text = 5; x.a = 55.5; };
const removes: Spoiler = (x) => { delete x.a; x.a = 66.5; };
const accessor: Spoiler = (x) => { const y: any = x; Object.defineProperty(y, "a", { get() { return 77.5; }, configurable: true }); };
const parent: Spoiler = (x) => { delete x.a; Object.setPrototypeOf(x, { a: 88.5 }); };
const spoilers: Spoiler[] = [nothing, misfit, removes, accessor, parent];
const names = ["nothing", "misfit", "removes", "accessor", "parent"];

function straight(o: T, f: Spoiler): string { const before = o.a; f(o); return before + " then " + o.a; }
function inner(p: T, f: Spoiler): unknown { f(p); return p.a; }
function throughCall(o: T, f: Spoiler): string { const before = o.a; return before + " then " + inner(o, f); }
function throughJump(o: T, f: Spoiler): string { const q = o.next!; const before = o.a + q.a; let p = o; if (o.kind & 4) p = q; f(p); return before + " then " + p.a; }
function inLoop(o: T, f: Spoiler): string { let s = ""; for (let i = 0; i < 3; i++) { s += o.a + ","; if (i === 1) f(o); } return s; }
function pick(o: T): T { return o; }
function throughResult(o: T, f: Spoiler): string { const p = pick(o); const before = p.a; f(o); return before + " then " + p.a + " " + pick(o).a; }
function otherName(o: T, f: Spoiler): string { const before = o.b; f(o); return before + " then " + o.b + " " + o.a; }
function store(o: T, f: Spoiler): string { o.b = 7; f(o); o.b = 8; return o.b + " " + o.a; }
function chain(o: T, f: Spoiler): string { const before = o.next!.a; f(o.next); return before + " then " + o.next!.a; }
function sums(o: T, f: Spoiler): string { const before = o.a + o.b + o.c + o.d; f(o); return before + " then " + (o.a + o.b + o.c + o.d); }
const table: ((o: T, f: Spoiler) => string)[] = [straight, throughCall, throughJump, inLoop, throughResult, otherName, store, chain, sums];
const roads = ["straight", "through a call", "through a jump", "in a loop", "through a result", "another name", "a store", "a chain", "sums"];
globalThis.kept = [table, inner, pick];
let said = "";
for (let k = 0; k < spoilers.length; k++) {
    const f = spoilers[k];
    try { said = straight(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[0] + ": " + said);
    try { said = throughCall(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[1] + ": " + said);
    try { said = throughJump(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[2] + ": " + said);
    try { said = inLoop(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[3] + ": " + said);
    try { said = throughResult(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[4] + ": " + said);
    try { said = otherName(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[5] + ": " + said);
    try { said = store(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[6] + ": " + said);
    try { said = chain(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[7] + ": " + said);
    try { said = sums(fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
    console.log(names[k] + " " + roads[8] + ": " + said);
    for (let j = 0; j < table.length; j++) {
        try { said = table[j](fresh(), f); } catch (e) { said = "THROWS " + (e as any).name; }
        console.log(names[k] + " " + roads[j] + ", by the table: " + said);
    }
}
console.log(door.length, taken);
