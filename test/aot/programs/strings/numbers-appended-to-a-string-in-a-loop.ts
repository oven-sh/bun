declare const console: { log(...values: unknown[]): void };
class Item { id: number; constructor(id: number) { this.id = id; } }
function idsOf(items: readonly Item[]): string { let result = ""; for (const item of items) { if (result.length) result += ","; result += item.id; } return result; }
function countsOf(values: readonly number[]): string { let result = ""; for (let i = 0; i < values.length; i++) { result += i; result += ":"; result += values[i] | 0; result += ";"; } return result; }
function numbersOf(values: readonly number[]): string { let result = ""; for (const value of values) { result += value; result += " "; } return result; }
function long(n: number): number { let result = ""; for (let i = 0; i < n; i++) { result += i * 7919; result += "."; } let sum = 0; for (let i = 0; i < result.length; i++) sum = (sum * 31 + result.charCodeAt(i)) | 0; return sum + result.length; }
const edges: number[] = [];
for (let power = 1; power <= 1000000000; power *= 10) edges.push(power - 2, power - 1, power, power + 1, power * 2, power * 5 + 5, power * 9);
edges.push(0, 7, 42, 100, 101, 110, 1001, 1010, 1100, 10000001, 10100000, 12345678, 87654321, 99999999, 100000000, 100000001, 2147483647, 2147483648, 4294967295, -1, -9, -10, -99999999, -100000000, -2147483648, -0, 0.5, 1e21, NaN, Infinity);
for (let round = 0; round < 2; round++) {
    console.log(idsOf(edges.map(value => new Item(value))));
    console.log(countsOf(edges));
    console.log(numbersOf(edges));
    console.log(idsOf([]), "|", idsOf([new Item(0)]), "|", idsOf([new Item(10), new Item(9)]));
}
let check = 0;
for (let start = 0; start < 100000000; start += 1234567) { const items: Item[] = []; for (let i = 0; i < 40; i++) items.push(new Item(start + i * 31)); const text = idsOf(items); const expected = items.map(item => String(item.id)).join(","); if (text !== expected) { console.log("WRONG", text, expected); check++; } }
console.log("wrong:", check, long(20000));
