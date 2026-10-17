declare const console: { log(...values: unknown[]): void };
const out: string[] = [];
const hide = (v: any): any => v;
const attempt = (f: () => unknown): string => { try { const v = f(); return typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v); } catch (e) { return (e as Error).name; } };
const engineMade = (text: string): any => JSON.parse(text);
// Read with the declared type: a path that trusts the kind of storage would show the raw contents.
function numberAt(a: number[], i: number): number | undefined { return a[i]; }
function sumOf(a: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v !== undefined) s += v; } return s; }
function describe(a: unknown[]): string { const parts: string[] = []; for (let i = 0; i < a.length; i++) parts.push((i in a ? "" : "hole:") + typeof a[i] + ":" + String(a[i])); return "[" + a.length + "] " + parts.join(" "); }
// The stored value is not known to be a number.
function store(a: unknown[], i: number, v: unknown): void { a[i] = v; }
const stores: ((a: unknown[], i: number, v: unknown) => void)[] = [store];
for (const [what, make] of [["int32s", () => engineMade("[1,2,3]")], ["doubles", () => engineMade("[1.5,2.5,3.5]")], ["undecided", () => new Array(3)], ["shared int32s", () => hide([1, 2, 3])], ["shared doubles", () => hide([1.5, 2.5, 3.5])], ["sparse", () => { const a = engineMade("[1,2,3]"); a[5000] = 1; a.length = 3; return a; }], ["values", () => engineMade('["a","b","c"]')]] as [string, () => any][]) {
  const line: string[] = [];
  for (const v of [7, 0.5, "text", NaN, -0, undefined, null, true, { toString() { return "object"; } }, 2 ** 31, Infinity]) {
    const a = make(); const stored = attempt(() => stores[0]!(a, 1, v)); if (stored !== "undefined") line.push(stored);
    line.push(attempt(() => describe(a)) + " / " + attempt(() => numberAt(a, 1)) + " / " + attempt(() => sumOf(a)) + " / " + attempt(() => a.indexOf(v) + " " + a.includes(v) + " " + JSON.stringify(a)));
  }
  out.push("a store to " + what + ": " + line.join(" | "));
}
{ const first = (): number[] => [1.5, 2.5, 3.5]; const a = first(); stores[0]!(a as unknown[], 0, "x"); out.push("the literal behind a store: " + first().join()); }
function storeNumber(a: number[], i: number, v: number): void { a[i] = v; }
{ const putters: ((a: number[], i: number, v: number) => void)[] = [storeNumber]; const zero = hide(0) as number; const a: number[] = engineMade("[0.5,1.5,2.5]"); putters[0]!(a, 1, zero / zero); const b: number[] = engineMade("[1,2,3]"); putters[0]!(b, 1, zero / zero); out.push("a NaN stored as a number: " + describe(a as unknown[]) + " " + (1 in a) + " | " + describe(b as unknown[]) + " " + (1 in b)); }
// getArrayElement(): a hole among int32s, among doubles, among values.
for (const text of ["[1,2,3]", "[1.5,2.5,3.5]", '["a","b","c"]']) { const a = engineMade(text); delete a[1]; out.push("a hole in " + text + ": " + attempt(() => numberAt(a, 1)) + " " + attempt(() => hide(a)[1]) + " " + attempt(() => sumOf(a)) + " " + (1 in a) + " " + attempt(() => listOf(a))); }
// An array that is no longer plain is asked for its iterator.
function listOf(a: number[]): string { const seen: number[] = []; for (const v of a) seen.push(v); return seen.join(); }
class Backwards extends Array<number> { *[Symbol.iterator](): any { for (let i = this.length - 1; i >= 0; i--) yield this[i]; } }
{ const heir = new Backwards(); heir.push(1, 2, 3); const own: number[] = [1, 2, 3]; (own as any)[Symbol.iterator] = function* () { yield 9; yield 8; }; const reparented: number[] = [1, 2, 3]; Object.setPrototypeOf(reparented, { __proto__: Array.prototype, *[Symbol.iterator]() { yield 7; } });
  out.push("iterated: " + [() => listOf([1, 2, 3]), () => listOf(heir), () => listOf(own), () => listOf(reparented)].map(attempt).join(" | ")); }
// A key that represents undefined; a key that is not a number.
// @ts-ignore
function atMaybe(a: any, flag: boolean): unknown { const i = flag ? 1 : undefined; return a[i]; }
// @ts-ignore
function textAtMaybe(a: string[], flag: boolean): unknown { const i = flag ? 1 : undefined; return a[i]; }
function atAny(a: any, k: any): unknown { return a[k]; }
function putAny(a: any, k: any, v: unknown): unknown { a[k] = v; return a[k]; }
{ const a: any = ["x", "y", "z"]; a.undefined = "named undefined"; a.extra = "named extra";
  for (let i = 0; i < 3; i++) atAny(a, i);
  out.push("keys: " + [attempt(() => atMaybe(a, true)), attempt(() => atMaybe(a, false)), attempt(() => textAtMaybe(a, true)), attempt(() => textAtMaybe(a, false)), atAny(a, 1), atAny(a, "length"), atAny(a, "extra"), atAny(a, "1"), atAny(a, 1.5), atAny(a, -1), atAny(a, null), atAny(a, { toString() { return "2"; } }), atAny(a, Symbol.iterator) === Array.prototype[Symbol.iterator], putAny(a, "later", 5), putAny(a, 1.5, 6), putAny(a, "0", "zero"), a.length, a[0]].map(String).join(" | ")); }
// Typed arrays: an inheriting object, a view that follows its buffer, a view without a buffer.
function bytesOf(v: Uint8Array): string { const seen: number[] = []; for (const b of v) seen.push(b); return seen.join(); }
function byteAt(v: Uint8Array, i: number): number | undefined { return v[i]; }
function onlyOpened(v: Uint8Array): string { const [] = v; return "opened"; }
class Doubled extends Uint8Array { *[Symbol.iterator](): any { for (let i = 0; i < this.length; i++) yield this[i]! * 2; } }
{ const heir = new Doubled([1, 2, 3]); const own = new Uint8Array([1, 2, 3]); (own as any)[Symbol.iterator] = function* () { yield 5; };
  const buffer = new (ArrayBuffer as any)(2, { maxByteLength: 8 }); const following = new Uint8Array(buffer); following[0] = 1; following[1] = 2;
  const grows = (v: Uint8Array): string => { const seen: number[] = []; for (const b of v) { seen.push(b); if (seen.length === 1) buffer.resize(4); } return seen.join(); };
  const before = attempt(() => bytesOf(following) + "/" + byteAt(following, 3)); const during = attempt(() => grows(following)); const after = attempt(() => bytesOf(following) + "/" + byteAt(following, 3) + "/" + byteAt(following, 4));
  buffer.resize(0); const emptied = attempt(() => bytesOf(following) + "/" + byteAt(following, 0));
  const shrinking = new (ArrayBuffer as any)(4, { maxByteLength: 8 }); const fixed = new Uint8Array(shrinking, 0, 3); fixed[0] = 4; fixed[1] = 5; fixed[2] = 6; const whole = attempt(() => bytesOf(fixed)); shrinking.resize(2); const outOfBounds = attempt(() => bytesOf(fixed)) + "/" + attempt(() => byteAt(fixed, 0)) + "/" + fixed.length + "/" + attempt(() => onlyOpened(fixed)); shrinking.resize(4); const backAgain = attempt(() => bytesOf(fixed));
  const gone = new Uint8Array([1, 2, 3]); const goesAway = (v: Uint8Array): string => { const seen: number[] = []; for (const b of v) { seen.push(b); if (seen.length === 1) (v.buffer as any).transfer(); } return seen.join(); };
  out.push("typed arrays: " + [bytesOf(new Uint8Array([1, 2, 3])), attempt(() => bytesOf(heir)), attempt(() => bytesOf(own)), before, during, after, emptied, whole, outOfBounds, backAgain, bytesOf(new Uint8Array(0)), attempt(() => onlyOpened(gone)), attempt(() => goesAway(gone)), attempt(() => bytesOf(gone)), attempt(() => onlyOpened(gone)), attempt(() => onlyOpened(new Uint8Array(0))), attempt(() => onlyOpened(following)), attempt(() => byteAt(gone, 0)), attempt(() => byteAt(hide(undefined), 0)), attempt(() => byteAt(hide(null), 0)), attempt(() => bytesOf(hide(undefined)))].join(" | ")); }
// `length = n`: in place only where the array has its elements in place and to itself.
function cut(a: unknown[], n: number): string { a.length = n; return describe(a); }
function cutNumbers(a: number[], n: number): string { a.length = n; return a.length + ":" + a.join(); }
{ const literal = (): number[] => [1, 2, 3, 4]; const texts = (): string[] => ["a", "b", "c", "d"]; const sparse = engineMade("[1,2,3,4]"); sparse[5000] = 1;
  const long: number[] = []; for (let i = 0; i < 300; i++) long.push(i);
  out.push("cut: " + [() => cutNumbers(literal(), 2), () => literal().join(), () => cutNumbers(hide(sparse.slice()), 1), () => cutNumbers(engineMade("[1,2,3]"), 2), () => cut(literal() as unknown[], 2), () => literal().join(), () => cut(texts() as unknown[], 1), () => texts().join(), () => cut(sparse, 2), () => cut(engineMade("[1.5,2.5,3.5]"), 1), () => cut(long as unknown[], 3), () => (long.length = 6, describe(long as unknown[])), () => cut(engineMade("[1,2]"), 4)].map(attempt).concat([ attempt(() => cut(Object.freeze([1, 2]) as any, 1)), attempt(() => cut([1] as unknown[], -1))]).join(" | ")); }
// Several pushed at once, a NaN among them.
function pushTwo(a: number[], x: number, y: number): number { return a.push(x, y); }
{ const pushers: ((a: number[], x: number, y: number) => number)[] = [pushTwo]; const zero = hide(0) as number; const a: number[] = engineMade("[0.5]"); a.push(0.25); a.pop(); const n = pushers[0]!(a, 1.5, zero / zero); const b: number[] = engineMade("[0.5]"); b.push(0.25); b.pop(); pushers[0]!(b, zero / zero, 2.5); out.push("pushed: " + n + " " + describe(a as unknown[]) + " " + (2 in a) + " " + a.includes(NaN) + " | " + describe(b as unknown[]) + " " + (1 in b) + " " + attempt(() => sumOf(b))); }
// A value that is expected to be a string but is a cell of another kind.
function pieces(s: string | string[]): string { const seen: string[] = []; for (const c of s) seen.push(c); return seen.join("+"); }
function expectedText(s: unknown): string { const seen: string[] = []; for (const c of s as string) seen.push(c); return seen.join("+"); }
function characters(s: any): string { const seen: string[] = []; for (const c of s) seen.push(String(c)); return seen.join("+"); }
{ for (let i = 0; i < 3; i++) characters("ab"); out.push("iterated as a string: " + [attempt(() => expectedText("gh")), attempt(() => expectedText(["ij", "k"])), attempt(() => expectedText(new Set(["l"]))), attempt(() => expectedText(7)), pieces("a\u{1F600}b"), attempt(() => pieces(["xy", "z"])), attempt(() => pieces(hide(new Set(["p", "q"])))), attempt(() => pieces(hide(new String("ef")))), characters("a\u{1F600}b"), attempt(() => characters(["xy", "z"])), attempt(() => characters(new Set([1, 2]))), attempt(() => characters({})), attempt(() => characters(5)), attempt(() => characters(new String("cd")))].join(" | ")); }
console.log(out.join("\n"));
