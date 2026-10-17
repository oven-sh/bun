declare const console: { log(...values: unknown[]): void };
class Item { id: number; weight: number | undefined; constructor(id: number, weight?: number) { this.id = id; this.weight = weight; } }
let depth = 0;
function label(item: Item): string { if (depth > 0) { depth--; label(item); } return "#" + item.id; }
function pair(a: Item, b: Item): string { if (depth > 0) { depth--; pair(a, b); } return a.id + "," + b.id; }
function template(a: Item, b: Item): string { if (depth > 0) { depth--; template(a, b); } return `${a.id}:${b.id}|${a.weight}`; }
function listOf(items: readonly Item[]): string { let result = ""; for (const item of items) { if (result.length) result += ","; result += item.id; } return result; }
function usedBothWays(item: Item, table: string[]): string { if (depth > 0) { depth--; usedBothWays(item, table); } const id = item.id; return id + "=" + table[id] + (id === 2 ? "!" : "") + (id < 3 ? "<" : ">"); }
function ofParameter(value: number): string { if (depth > 0) { depth--; ofParameter(value); } return "p" + value + "/" + String(value) + "/" + value.toString(); }
function sumThenText(a: Item, b: Item): string { if (depth > 0) { depth--; sumThenText(a, b); } return "s" + (a.id + b.id) + "d" + (a.id - b.id) + "m" + a.id * b.id; }
const values = [0, 1, 2, 3, 9, 10, 99, 100, 1023, 1024, 99999999, 100000000, 123456789, 2147483647, 2147483648, 4294967295, 4294967296, -1, -2, -1024, -2147483648, -2147483649, -0, 0.5, -0.5, 1.5, 1e21, 1e-7, 123456789012345680000, NaN, Infinity, -Infinity, 9007199254740991, 9007199254740992, -9007199254740992, -9223372036854775808, 5e-324, 1.7976931348623157e308];
const table = ["zero", "one", "two"];
for (let round = 0; round < 2; round++) {
    for (const value of values) {
        const item = new Item(value, round ? value : undefined);
        const other = new Item(7);
        console.log(label(item), pair(item, other), pair(other, item), template(item, other), usedBothWays(item, table), ofParameter(value), sumThenText(item, other));
    }
    console.log(listOf(values.map(value => new Item(value))));
    console.log(listOf([]), "|", listOf([new Item(5)]), "|", listOf([new Item(-0), new Item(-0)]));
}
const changing = new Item(1);
let text = "";
for (const value of values) { changing.id = value; text += label(changing); changing.id = 3; text += label(changing); }
console.log(text);
