// A parameter, a result, a property of type `number | undefined`, `number | null` or all three, given by code that says nothing about types: integers, doubles, NaN, -0, the infinities, undefined, null.

const lines: string[] = [];
function show(n: number | undefined | null): string { return n === undefined ? "undefined" : n === null ? "null" : Object.is(n, -0) ? "-0" : String(n); }
function optional(n?: number): string { return show(n); }
function orNull(n: number | null): string { return show(n); }
function either(n: number | undefined | null): string { return show(n); }
function sum(a: number | undefined, b: number | null, c?: number): number { return (a ?? 1) + (b ?? 2) + (c ?? 3); }
function handedOn(n: number | undefined): number | undefined { return n; }
function doubled(n: number | null): number | null { return n === null ? null : n * 2; }
function kept(n: number | undefined): { n: number | undefined } { return { n }; }

const numbers: unknown[] = [0, -0, 1, -1, 0.5, -2.75, 2147483647, -2147483648, 2147483648, 4294967296.5, 1e300, NaN, Infinity, -Infinity, Number.MIN_VALUE];
const byValue: Record<string, (...given: any[]) => unknown> = { optional, orNull, either, sum, handedOn, doubled, kept };
for (const n of numbers) {
    lines.push([byValue.optional(n), byValue.orNull(n), byValue.either(n), show(byValue.handedOn(n) as number), show(byValue.doubled(n) as number), show((byValue.kept(n) as { n: number }).n), show(byValue.sum(n, n, n) as number)].join(" "));
}
lines.push([byValue.optional(undefined), byValue.optional(), byValue.orNull(null), byValue.either(undefined), byValue.either(null), byValue.either()].join(" "));
lines.push([byValue.sum(undefined, null), byValue.sum(undefined, null, undefined), byValue.sum(1.5, null, 2), byValue.sum(undefined, 4, 0.25), show(byValue.handedOn(undefined) as undefined), show(byValue.doubled(null) as null)].join(" "));

const outside: any = JSON.parse('{"a":1,"b":2.5,"c":null,"e":-0.0,"f":1e21}');
function read(o: any, key: string): string { const n: number | undefined | null = o[key]; return show(n); }
lines.push(["a", "b", "c", "d", "e", "f"].map(key => read(outside, key)).join(" "));

let total = 0;
for (let i = 0; i < 3000; i++) total += byValue.sum(i & 1 ? i : undefined, i & 2 ? i + 0.5 : null, i & 4 ? -i : undefined) as number;
lines.push(String(total));
console.log(lines.join("\n"));
