// `for (const [i, x] of array.entries())` allocates no iterator and no pairs unless the program can observe them.
// CALLS+ typed operationAOTNewArrayIterator
// CALLS- untyped operationAOTNewArrayIterator
// CALLS+ ofArraysOnly operationAOTNewArrayIterator
// CALLS+ indexOnly operationAOTNewArrayIterator
// CALLS+ elementOnly operationAOTNewArrayIterator
// CALLS+ nestedPattern operationAOTNewArrayIterator
// CALLS- whole operationAOTNewArrayIterator
// CALLS- kept operationAOTNewArrayIterator
// CALLS- held operationAOTNewArrayIterator
// CALLS- withRest operationAOTNewArrayIterator
// CALLS- spread operationAOTNewArrayIterator
const print = (s: string) => console.log(s);
function show(x: unknown): string {
    if (typeof x !== "string")
        return Object.is(x, -0) ? "-0" : String(x);
    let out = '"';
    for (let i = 0; i < x.length; i++) {
        const c = x.charCodeAt(i);
        out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 0x10000).toString(16).slice(1);
    }
    return out + '"';
}
function attempt(f: () => unknown): string {
    try {
        return show(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function cat(a: string, b: string): string { return a + b; }
function cat3(a: string, b: string, c: string): string { return `${a}${b}${c}`; }
function part(s: string, from: number, to: number): string { return s.slice(from, to); }
function flattened(s: string): string { s.charCodeAt(0); return s; }

const log: string[] = [];
export function typed(list: number[]): string { let out = ""; for (const [i, x] of list.entries()) out += i + ":" + x + ","; return out; }
export function ofStrings(list: string[]): string { let out = ""; for (const [i, x] of list.entries()) out += i + x.length + x + ","; return out; }
export function untyped(list: any): any { let out = ""; for (const [i, x] of list.entries()) out += i + ":" + String(x) + ","; return out; }
export function ofArraysOnly(list: any): any { let out = ""; for (const [i, x] of list.entries()) out += i + ":" + String(x) + ","; return out; }
export function indexOnly(list: any): any { let out = ""; for (const [i] of list.entries()) out += i + ","; return out; }
export function elementOnly(list: any): any { let out = ""; for (const [, x] of list.entries()) out += String(x) + ","; return out; }
export function three(list: any): any { let out = ""; for (const [i, x, y] of list.entries()) out += i + String(x) + String(y) + ","; return out; }
export function withDefaults(list: any): any { let out = ""; for (const [i = -1, x = "none"] of list.entries()) out += i + String(x) + ","; return out; }
export function nestedPattern(list: any): any { let out = ""; for (const [i, [a, b]] of list.entries()) out += i + String(a) + String(b) + ","; return out; }
export function ofObjects(list: any): any { let out = ""; for (const [i, { name }] of list.entries()) out += i + String(name) + ","; return out; }
export function assigned(list: any): any { let i: any, x: any, out = ""; for ([i, x] of list.entries()) out += i + String(x) + ","; return out + i + String(x); }
export function whole(list: any): any { let out = ""; for (const pair of list.entries()) out += pair.length + ":" + pair.join("=") + ","; return out; }
export function kept(list: any): any { const pairs: any[] = []; for (const pair of list.entries()) { const [i, x] = pair; if (i & 1) pairs.push(pair); log.push(String(x)); } return pairs.join("|"); }
export function held(list: any): any { const it = list.entries(); let out = ""; for (const [i, x] of it) { out += i + String(x) + ","; if (i === 1) break; } return out + JSON.stringify(it.next()); }
export function withRest(list: any): any { let out = ""; for (const [i, ...rest] of list.entries()) out += i + ":" + rest.length + ","; return out; }
export function spread(list: any): any { return [...list.entries()].join("|") + Array.from(list.entries(), ([i, x]: any) => i + String(x)).join(); }
export function changing(list: any, what: string): any { let out = "", n = 0; for (const [i, x] of list.entries()) { out += i + String(x) + ","; if (++n > 12) break; if (i === 1) { if (what === "push") list.push("p" + n); else if (what === "pop") list.pop(); else if (what === "shift") list.shift(); else if (what === "length") list.length = 2; else if (what === "clear") list.length = 0; else if (what === "store") list[3] = "stored"; else if (what === "far") list[9] = "far"; else if (what === "delete") delete list[2]; else if (what === "property") list.extra = 1; else if (what === "entries") list.entries = () => [["x", "y"]][Symbol.iterator](); else if (what === "prototype") Object.setPrototypeOf(list, { 2: "inherited" }); else if (what === "freeze") Object.freeze(list); else if (what === "sort") list.reverse(); else if (what === "unshift") list.unshift("u"); } } return out; }
export function leaving(list: any, at: number): any { let out = ""; for (const [i, x] of list.entries()) { if (i === at) break; if (i === at - 1) continue; if (i === at + 2) return "R" + out; out += String(x); } return out; }
export function throwing(list: any): any { let out = ""; try { for (const [i, x] of list.entries()) { try { if (i === 1) throw new Error("inner"); out += String(x); } catch (e) { out += "!"; } if (i === 2) throw new Error("outer"); } } catch (e) { out += (e as Error).message; } finally { out += "."; } return out; }
export function nestedLoops(a: any, b: any): any { let out = ""; for (const [i, x] of a.entries()) for (const [j, y] of b.entries()) for (const [k] of a.entries()) out += "" + i + j + k + String(x) + String(y) + ","; return out; }
export async function awaiting(list: any): Promise<any> { let out = ""; for (const [i, x] of list.entries()) { await null; out += i + String(x); } return out; }
export function* yielding(list: any): Generator<any> { for (const [i, x] of list.entries()) { yield i; yield x; } }
export function chosen(list: any, other: any, which: boolean): any { let out = ""; for (const [i, x] of (which ? list.entries() : other.entries())) out += i + String(x) + ","; return out; }
export function closures(list: any): any { const made: any[] = []; for (const [i, x] of list.entries()) made.push(() => i + String(x)); return made.map(f => f()).join(); }
export function summed(list: number[]): number { let s = 0; for (const [i, x] of list.entries()) s += i * x; return s; }
print(typed([5, 6, 7]) + " " + typed([]) + "|" + typed([1.5, -0, NaN]) + " " + ofStrings(["a", "", "ccc"]) + " " + untyped([5, "s", null, undefined, {}, [1]]) + " " + indexOnly(["a", "b"]) + " " + elementOnly(["a", "b"]) + " " + three(["a"]) + " " + withDefaults([undefined, null, 0]) + " " + nestedPattern([[1, 2], "xy", [3]]) + " " + ofObjects([{ name: "n" }, {}, "s"]) + " " + assigned(["p", "q"]));
print(ofArraysOnly([5, "s", null]) + ofArraysOnly([]) + ofArraysOnly([[1], {}]));
print(whole(["a", "b"]) + " " + kept(["a", "b", "c", "d"]) + " " + log.splice(0).join() + " " + held(["a", "b", "c"]) + " " + withRest(["a"]) + " " + spread(["a", "b"]) + " " + closures(["a", "b", "c"]) + " " + summed([1, 2, 3, 4]) + " " + summed(Array.from({ length: 1000 }, (_, i) => i)));
// Holes, kinds of storage, long ones.
{ const holes: any = [1, , 3]; const doubles = [1.5, 2.5]; const far: any = []; far[3] = "x"; const sparse: any = []; sparse[100000] = 1; let n = 0; for (const [i, x] of sparse.entries()) if (x !== undefined || i === 7) n += i; print(untyped(holes) + " " + untyped(doubles) + " " + untyped(far) + " " + n + " " + untyped(new Array(2)) + " " + untyped(Object.freeze(["f"])) + " " + untyped([..."ab"]) + " " + untyped("a,b".split(","))); }
for (const what of ["push", "pop", "shift", "length", "clear", "store", "far", "delete", "property", "entries", "prototype", "freeze", "sort", "unshift"]) print(what + ": " + attempt(() => changing(["a", "b", "c", "d"], what)));
for (let at = 0; at < 5; at++) print(leaving(["a", "b", "c", "d", "e"], at));
print(throwing(["a", "b", "c", "d"]) + " " + nestedLoops(["a", "b"], ["x"]) + " " + [...yielding(["a", "b"])].join() + " " + chosen(["a"], ["b", "c"], true) + chosen(["a"], ["b", "c"], false));
// The difference is observable, or it is not an array.
{ const own: any = ["a", "b"]; own.entries = function () { log.push("own entries"); return [["k", "v"]][Symbol.iterator](); }; print(untyped(own) + log.splice(0).join()); }
{ class List extends Array<any> { entries(): any { log.push("subclass"); return super.entries(); } } const l = List.from(["a", "b"]); print(untyped(l) + log.splice(0).join()); class Plain extends Array<any> { } print(untyped(Plain.from(["p", "q"]))); }
{ const stored = ["s", "t"].entries(); const giving = { entries() { return stored; } }; print(untyped(giving) + JSON.stringify(stored.next()) + " " + untyped({ entries: () => new Map([[1, 2]]).entries() }) + " " + untyped({ entries: () => [[7, 8], "ab"] }) + " " + untyped(new Map([["k", "v"]])) + " " + untyped(new Set(["s"])) + " " + untyped(new Uint8Array([9, 8])) + " " + untyped({ entries: Array.prototype.entries, length: 2, 0: "l", 1: "m" })); }
{ const closing = { entries() { let i = 0; return { [Symbol.iterator]() { return this; }, next: () => ({ done: i > 2, value: [i, "c" + i++] }), return() { log.push("closed"); return {}; } }; } }; print(leaving(closing, 1) + log.splice(0).join() + " " + attempt(() => untyped({ entries: () => [1] })) + " " + attempt(() => untyped({ entries: () => 5 })) + " " + attempt(() => untyped({})) + " " + attempt(() => untyped(undefined)) + " " + attempt(() => typed(null as any))); }
{ (function (this: any) { print(untyped(Array.prototype.slice.call(arguments)) + attempt(() => untyped(arguments))); } as any)("x", "y"); }
(async () => { print(await awaiting(["a", "b", "c"])); print((await Promise.all([awaiting(["x"]), awaiting(["y", "z"])])).join()); })();
(globalThis as any).kept = [typed, ofStrings, untyped, ofArraysOnly, indexOnly, elementOnly, three, withDefaults, nestedPattern, ofObjects, assigned, whole, kept, held, withRest, spread, changing, leaving, throwing, nestedLoops, awaiting, yielding, chosen, closures, summed]; console.log("number");
