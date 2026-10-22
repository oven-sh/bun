// As object-stops-matching-between-reads.ts, but the code that changes the object runs out of sight: in toString() and
// valueOf(), in an accessor of another object, behind a throw, in a finally block, across an await and a yield, or it is a store to a
// discriminant through a wider type. The fields that are read again hold numbers throughout, so each read answers as the language says. The discriminant ends up with a string outside its literal type, and its next typed read gives that string.
declare const console: { log(...values: unknown[]): void };
declare const globalThis: { kept?: unknown };
declare const JSON: { parse(s: string): any };
declare const Object: { defineProperty(o: any, k: string, d: any): any; setPrototypeOf(o: any, p: any): any };
interface Inner { v: number; w: number }
interface T { a: number; b: number; c: number; d: number; kind: number; ref: Inner; next: T | null; opt?: Inner; flag: boolean; text: string }
function make(i: number): T { return { a: i + 0.5, b: i + 1.5, c: i + 2.5, d: i + 3.5, kind: i, ref: { v: i, w: i + 1 }, next: null, flag: (i & 1) === 0, text: "t" + i } }
const door: T[] = JSON.parse('[{"a":1,"b":2,"c":3,"d":4,"kind":1,"ref":{"v":1,"w":2},"next":null,"flag":true,"text":"s"}]') as T[];
const pool: T[] = [];
for (let i = 0; i < 400; i++) pool.push(make(i));
let taken = 0;
function fresh(): T { taken += 2; return pool[taken]; }
let victim: any = null;
let how = 0;
function spoil(): void {
    const x = victim;
    if (how === 1) { x.text = 5; x.a = 55.5; }
    else if (how === 2) { delete x.a; x.a = 66.5; }
    else if (how === 3) Object.defineProperty(x, "a", { get() { return 77.5; }, configurable: true });
    else if (how === 4) { delete x.a; Object.setPrototypeOf(x, { a: 88.5 }); }
}
const names = ["nothing", "misfit", "removes", "accessor", "parent"];
interface Speaks { toString(): string }
interface Weighs { valueOf(): number }
const speaks: Speaks = { toString() { spoil(); return "said"; } };
const weighs: Weighs = { valueOf() { spoil(); return 1; } };
function strangerThatSpoils(): T { const s: any = JSON.parse('{"a":1,"c":3,"d":4,"kind":1,"ref":{"v":1,"w":2},"next":null,"flag":true,"text":"s"}'); let held = 2; Object.defineProperty(s, "b", { get() { spoil(); return held; }, set(v: number) { spoil(); held = v; }, configurable: true, enumerable: true }); return s as T; }

function byTemplate(o: T, x: Speaks): string { const before = o.a; const s = `${x}`; return before + " " + s + " then " + o.a; }
function byConcatenation(o: T, x: Speaks): string { const before = o.a; const s = "" + x; return before + " " + s + " then " + o.a; }
function byPlus(o: T, x: Weighs): string { const before = o.a; const n = +(x as any); return before + " " + n + " then " + o.a; }
function byTimes(o: T, x: Weighs): string { const before = o.a; const n = (x as any) * 2; return before + " " + n + " then " + o.a; }
function byLess(o: T, x: Weighs): string { const before = o.a; const n = (x as any) < 5; return before + " " + n + " then " + o.a; }
function byGetterOfStranger(o: T, q: T): string { const before = o.a + q.a; const n = q.b; return before + " " + n + " then " + o.a + " " + q.a; }
function bySetterOfStranger(o: T, q: T): string { const before = o.a + q.a; q.b = 9; return before + " then " + o.a + " " + q.a; }
function byThrow(o: T): string { const before = o.a; try { spoil(); throw new Error("x"); } catch (e) { } return before + " then " + o.a; }
function byFinally(o: T): string { const before = o.a; try { if (before < 0) return "never"; } finally { spoil(); } return before + " then " + o.a; }
function byKey(o: T, x: Speaks): string { const before = o.a; const bag: any = {}; bag[x as any] = 1; return before + " then " + o.a; }
function bySecondTurn(o: T): string { let s = ""; for (let i = 0; i < 3; i++) { s += o.a + o.b + ","; if (i === 0) spoil(); } return s; }
function byBranch(o: T, yes: boolean): string { const before = o.a; if (yes) spoil(); else victim = victim; return before + " then " + o.a + " " + o.b; }
async function byAwait(o: T): Promise<string> { const before = o.a; await null; return before + " then " + o.a; }
function* byYield(o: T): Generator<number, string, unknown> { const before = o.a; yield 1; return before + " then " + o.a; }
const table: unknown[] = [byTemplate, byConcatenation, byPlus, byTimes, byLess, byGetterOfStranger, bySetterOfStranger, byThrow, byFinally, byKey, bySecondTurn, byBranch, byAwait, byYield];
globalThis.kept = table;
function attempt(f: () => string): string { try { return f(); } catch (e) { return "THROWS " + (e as any).name; } }
function next(): T { const o = fresh(); victim = o; return o; }
const later: string[] = [];
for (how = 0; how < 5; how++) {
    const n = names[how];
    console.log(n + " a template: " + attempt(() => byTemplate(next(), speaks)));
    console.log(n + " a concatenation: " + attempt(() => byConcatenation(next(), speaks)));
    console.log(n + " a unary plus: " + attempt(() => byPlus(next(), weighs)));
    console.log(n + " a product: " + attempt(() => byTimes(next(), weighs)));
    console.log(n + " a comparison: " + attempt(() => byLess(next(), weighs)));
    console.log(n + " a getter of an object from outside: " + attempt(() => byGetterOfStranger(next(), strangerThatSpoils())));
    console.log(n + " a setter of an object from outside: " + attempt(() => bySetterOfStranger(next(), strangerThatSpoils())));
    console.log(n + " a throw: " + attempt(() => byThrow(next())));
    console.log(n + " a finally: " + attempt(() => byFinally(next())));
    console.log(n + " a key: " + attempt(() => byKey(next(), speaks)));
    console.log(n + " the second turn: " + attempt(() => bySecondTurn(next())));
    console.log(n + " a branch: " + attempt(() => byBranch(next(), true)) + " | " + attempt(() => byBranch(next(), false)));
    const g = byYield(next()); g.next(); spoil(); console.log(n + " a yield: " + attempt(() => g.next().value as string));
}
how = 1;
const awaited = next();
byAwait(awaited).then((s) => console.log("misfit an await: " + s));
spoil();

interface Circle { kind: "circle"; r: number; x: number; y: number; name: string; tag: number; e: number; f: number }
interface Square { kind: "square"; s: number; x: number; y: number; name: string; tag: number; e: number; f: number }
type Shape = Circle | Square;
interface Named { kind: string; x: number; y: number; name: string; tag: number; e: number; f: number }
const shapesFromOutside: Shape[] = JSON.parse('[{"kind":"circle","r":1,"x":0,"y":0,"name":"n","tag":1,"e":1,"f":2}]') as Shape[];
function circle(i: number): Circle { return { kind: "circle", r: i + 0.25, x: i, y: i + 1, name: "c" + i, tag: i, e: i, f: i } }
function rename(o: Circle, w: Named): string { const before = o.r + o.x; w.kind = "oval"; return before + " then " + (o.r + o.x) + " " + o.kind; }
function renameAlike(o: Circle, w: Named): string { const before = o.r + o.x; w.kind = "circle"; return before + " then " + (o.r + o.x) + " " + o.kind; }
globalThis.kept = [table, rename, renameAlike, shapesFromOutside];
for (let i = 0; i < 3; i++) { const c = circle(i); console.log("another discriminant: " + attempt(() => rename(c, c)) + " | " + attempt(() => renameAlike(circle(i + 10), circle(i + 20)))); }
