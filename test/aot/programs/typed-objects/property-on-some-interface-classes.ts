declare const console: { log(...values: unknown[]): void };
export { };
// Five classes behind one interface. Three of them have `value`, two of those have `unit`: the classes that have a property are a part of
// the classes of the interface, and reading it asks which part an object belongs to.
interface Item { name: string; value?: number; unit?: string; note?: string }
class Length implements Item { name = "length"; value?: number = 1; unit?: string = "m"; }
class Weight implements Item { name = "weight"; value?: number = 2; unit?: string = "kg"; }
class Count implements Item { name = "count"; value?: number = 3; }
class Label implements Item { name = "label"; note?: string = "n"; }
class Gap implements Item { name = "gap"; }
function valueOf(item: Item): number { return item.value === undefined ? -1 : item.value; }
function unitOf(item: Item): string { return item.unit === undefined ? "-" : item.unit; }
function noteOf(item: Item): string { return item.note === undefined ? "-" : item.note; }
function double(item: Item): void { if (item.value !== undefined) item.value = item.value * 2; }
function rename(item: Item, unit: string): void { if (item.unit !== undefined) item.unit = unit; }
function describe(item: Item): string { return item.name + ":" + valueOf(item) + unitOf(item) + noteOf(item); }
function total(items: Item[]): number { let sum = 0; for (const item of items) sum += valueOf(item) + unitOf(item).length + noteOf(item).length; return sum; }
const items: Item[] = [new Length(), new Weight(), new Count(), new Label(), new Gap()];
// Objects that typed code has not made, and that have all an Item must have.
const strangers: Item[] = [
    Object.assign(Object.create({ more: 1 }), { name: "made", value: 7, unit: "s" }) as Item,
    Object.assign(Object.create({ inherited: true }), { name: "heir", value: 8 }) as Item,
    Object.freeze({ name: "frozen", note: "kept" }) as Item,
    Object.assign((): number => 1, { value: 9 }) as unknown as Item,
    Object.assign([1, 2], { name: "list", unit: "u" }) as unknown as Item,
    Object.assign(new Map<string, number>(), { name: "map" }) as unknown as Item,
];
const all = items.concat(strangers);
let out = "";
for (let round = 0; round < 3; round++) {
    for (const item of all) {
        out += describe(item) + " ";
        try { double(item); rename(item, "r" + round); } catch (error) { out += "(" + (error as Error).constructor.name + ") "; }
    }
    out += total(all) + "\n";
}
console.log(out);
