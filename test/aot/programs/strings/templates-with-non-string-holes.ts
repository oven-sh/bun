// Template literals and concatenations away from loops, whose holes are strings or nil, numbers, booleans, big integers, and values of no known type: what each hole is made a string of, in which order, and what is thrown.
const out: string[] = [];
function two(x: string | undefined, y: string | null): string { return `${x}: ${y}`; }
function twoAgain(x: string | undefined, y: string | null): string { return `${x}= ${y}`; }
function swapped(x: string | undefined, y: string | null): string { return `${y}: ${x}`; }
function withNumber(x: string | undefined, n: number): string { return `[${x}] (${n})!`; }
function withNumberAgain(x: string | undefined, n: number): string { return `<${x}> {${n}}?`; }
function withNumberThird(x: string | undefined, n: number): string { return `"${x}" |${n}|.`; }
function withOptionalNumber(x: string, n?: number): string { return `${x}#${n}`; }
function withOptionalNumberAgain(x: string, n?: number): string { return `${x}@${n}`; }
function withOptionalNumberThird(x: string, n?: number): string { return `${x}%${n}`; }
function withBoolean(b: boolean, c: boolean | undefined): string { return `${b}/${c}`; }
function withBooleanAgain(b: boolean, c: boolean | undefined): string { return `${b}|${c}`; }
function withBooleanThird(b: boolean, c: boolean | undefined): string { return `${b}\\${c}`; }
function withBigInt(b: bigint, n: number): string { return `${b}n ${n}`; }
function withBigIntAgain(b: bigint, n: number): string { return `${b}m ${n}`; }
function withBigIntThird(b: bigint, n: number): string { return `${b}k ${n}`; }
function withAny(x: any, y: any): string { return `${x}, ${y}`; }
function withAnyAgain(x: any, y: any): string { return `${x}; ${y}`; }
function usedTwice(x: string | undefined): string { const s = `${x}`; return `${s}-${s}` + s.length; }
function sameHoleTwice(x: string | undefined, n: number): string { return `${x}${n}${x}${n}`; }
function computed(x: string | undefined, n: number): string { return `${x}:${n + 1}:${n * 0.5}:${-n}`; }
function sixHoles(a: string | undefined, b: number, c: boolean, d: string | null, e: number | undefined, f: string): string { return `${a}${b}${c}${d}${e}${f}`; }
function plus(x: string | undefined, n: number): string { return "a" + x + "b" + n + "c"; }
function inBranch(x: string | undefined, n: number, which: boolean): string { const s = which ? `${x}!${n}` : `${n}!${x}`; return s; }
const numbers = [0, -0, 1, -1, 1.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483647, 2147483648, 123456789012345680000];
for (const x of ["s", "", undefined, "ā", "a long string that is longer than any short string would be, and then some more"]) {
    for (const y of ["t", "", null]) out.push([two(x, y), twoAgain(x, y), swapped(x, y)].join(" ~ "));
    out.push(numbers.map(n => withNumber(x, n) + withNumberAgain(x, n) + withNumberThird(x, n) + sameHoleTwice(x, n) + computed(x, n) + plus(x, n) + inBranch(x, n, n > 0)).join(" "));
    out.push(usedTwice(x));
}
out.push(numbers.concat([undefined as any]).map(n => withOptionalNumber("k", n) + withOptionalNumberAgain("k", n) + withOptionalNumberThird("k", n)).join(" ") + withOptionalNumber("k") + withOptionalNumberAgain("k"));
out.push([withBoolean(true, false), withBoolean(false, undefined), withBooleanAgain(true, true), withBooleanAgain(false, undefined), withBooleanThird(true, undefined), withBooleanThird(false, false)].join(" "));
out.push([withBigInt(0n, 1), withBigInt(-12345678901234567890n, 2), withBigIntAgain(7n, NaN), withBigIntThird(-1n, -0)].join(" "));
out.push(sixHoles(undefined, 1, true, null, undefined, "z") + " " + sixHoles("a", -0, false, "d", 2.5, ""));
const log: string[] = [];
const noisy = (name: string) => ({ toString() { log.push(name); return name.toUpperCase(); } });
out.push(withAny(noisy("a"), noisy("b")) + " " + withAnyAgain(noisy("c"), noisy("d")) + " " + log.join(""));
out.push([withAny(1, "x"), withAny(null, undefined), withAny([1, [2, 3]], {}), withAny(1n, true), withAnyAgain([[]], /r/g)].join(" | "));
for (const bad of [[Symbol("s"), noisy("e")], [noisy("f"), Symbol("t")], [{ toString() { throw new RangeError("from toString"); } }, noisy("g")], [Object.create(null), 1]]) {
    try { out.push(withAny(bad[0], bad[1])); } catch (e) { out.push((e as Error).constructor.name + ": " + (e as Error).message + " after " + log.join("")); }
}
console.log(out.join("\n"));
