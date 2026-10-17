// `id + suffix` where the suffix is often the empty string: the result is the number's own string. Every kind of number, every kind of suffix, both orders, used as a value and as the key of a Map.
const out: string[] = [];
function after(id: number, suffix: string): string { return id + suffix; }
function before(prefix: string, id: number): string { return prefix + id; }
function around(prefix: string, id: number, suffix: string): string { return prefix + id + suffix; }
function optional(id: number | undefined, suffix: string): string { return id + suffix; }
function template(id: number, suffix: string): string { return `${id}${suffix}`; }
function alias(symbol: { id: number } | undefined, list: readonly number[] | undefined): string { return symbol ? "@" + symbol.id + (list ? ":" + list.join(",") : "") : ""; }
const cache = new Map<string, number>();
function cached(id: number, symbol: { id: number } | undefined): number {
    const key = id + alias(symbol, undefined);
    const found = cache.get(key);
    if (found !== undefined) return found;
    cache.set(key, cache.size);
    return -1;
}
const numbers = [0, -0, 1, 9, 10, 1023, 1024, 1025, 65536, 2147483647, 2147483648, -1, -2147483648, -2147483649, 4294967296, 1e21, 1.5, -0.25, NaN, Infinity, -Infinity, 123456789012];
const empty = ["x"].join("").slice(1);
const strings = ["", empty, "a", "@7", "ā", ("ab" + numbers.length).slice(2), ("" + numbers.length).slice(2), "a very long suffix that does not fit into the sixty-four characters of a short key at all"];
for (const n of numbers) {
    const line: string[] = [];
    for (const s of strings) line.push(after(n, s), before(s, n), around(s, n, s), optional(n, s), template(n, s));
    out.push(JSON.stringify(line.join("|")));
}
out.push(strings.map(s => optional(undefined, s)).join("|").length + " " + optional(undefined, ""));
let hits = 0;
for (let round = 0; round < 3; round++) for (let i = 0; i < 3000; i += 7) { if (cached(i, i % 5 ? undefined : { id: i >> 3 }) >= 0) hits++; }
out.push("hits " + hits + " of a cache of " + cache.size + ": " + [...cache.keys()].slice(0, 12).join(" "));
out.push(String(after(5, "") === "5") + String(after(5, "") === String(5)) + String(before("", 1024) === "1024") + String(cache.has(after(14, ""))) + String(cache.has(after(15, ""))));
console.log(out.join("\n"));
