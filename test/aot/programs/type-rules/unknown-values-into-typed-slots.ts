// Values whose type is not known enter places whose type is written down: in functions of one line and in large ones, called directly and as values,
// with numbers, strings and objects alive around the place. What fits goes on unchanged, what does not is a TypeError, and nothing else is disturbed.
type Point = { x: number; y: number };
type Named = { name: string };
type Open = { tag: string; size?: number };
class Animal { legs = 4; }
class Dog extends Animal { sound = "woof"; }
class Stone { weight = 9; }

function hide(value: unknown): any { return value; }
function show(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "function") return "function";
    if (Array.isArray(value)) return "array(" + value.length + ")";
    if (value instanceof Map) return "map(" + value.size + ")";
    if (typeof value === "object") return "object(" + Object.keys(value as object).join() + ")";
    return typeof value + " " + String(value);
}

function toText(v: any): string { const t: string = v; return t; }
function toTextOrNothing(v: any): string | undefined { const t: string | undefined = v; return t; }
function toPoint(v: any): Point { const t: Point = v; return t; }
function toPointOrNothing(v: any): Point | undefined { const t: Point | undefined = v; return t; }
function toPointOrNamed(v: any): Point | Named { const t: Point | Named = v; return t; }
function toAnimal(v: any): Animal { const t: Animal = v; return t; }
function toDog(v: any): Dog | null { const t: Dog | null = v; return t; }
function toOpen(v: any): Open { const t: Open = v; return t; }
function toList(v: any): number[] { const t: number[] = v; return t; }
function toMap(v: any): Map<string, number> | undefined { const t: Map<string, number> | undefined = v; return t; }
function toCallback(v: any): (() => number) | undefined { const t: (() => number) | undefined = v; return t; }
function toObject(v: any): object { const t: object = v; return t; }
function toTextOrNumber(v: any): string | number { const t: string | number = v; return t; }
function toTextOrFlag(v: any): string | boolean | undefined { const t: string | boolean | undefined = v; return t; }
function toTextOrPoint(v: any): string | Point | null { const t: string | Point | null = v; return t; }

const point: Point = { x: 1, y: 2 };
const named: Named = { name: "n" };
const marked: number[] = [1, 2, 3];
(marked as any).note = "an array with a property of its own";
class Numbers extends Array<number> {}
const heir = new Numbers();
heir.push(7);

const values: [string, any][] = [
    ["text", hide("s")], ["long text", hide("ab".repeat(3) + String(point.x))], ["undefined", hide(undefined)], ["null", hide(null)],
    ["integer", hide(3)], ["fraction", hide(1.5)], ["true", hide(true)], ["false", hide(false)],
    ["point", hide(point)], ["named", hide(named)], ["animal", hide(new Animal())], ["dog", hide(new Dog())], ["stone", hide(new Stone())],
    ["list", hide([4, 5])], ["marked list", hide(marked)], ["heir of Array", hide(heir)], ["map", hide(new Map([["k", 1]]))],
    ["callback", hide(() => 5)], ["method", hide(Math.max)], ["class", hide(Stone)], ["symbol", hide(Symbol.iterator)], ["big integer", hide(10n)],
    ["parsed", hide(JSON.parse('{"tag":"t","size":2}'))],
];
const places: [string, (v: any) => unknown][] = [
    ["string", toText], ["string?", toTextOrNothing], ["Point", toPoint], ["Point?", toPointOrNothing], ["Point | Named", toPointOrNamed],
    ["Animal", toAnimal], ["Dog | null", toDog], ["Open", toOpen], ["number[]", toList], ["Map?", toMap], ["callback?", toCallback],
    ["object", toObject], ["string | number", toTextOrNumber], ["string | boolean?", toTextOrFlag], ["string | Point | null", toTextOrPoint],
];
for (const [place, enter] of places) {
    const passed: string[] = [];
    let refused = 0;
    for (const [name, value] of values) {
        try {
            const held = enter(value);
            passed.push(held === value ? name : name + " (another: " + show(held) + ")");
        } catch (error) {
            if (!(error instanceof TypeError)) throw error;
            refused++;
        }
    }
    console.log(place + ": " + passed.join(", ") + " | refused " + refused);
}

// Much is alive around the place: all of it is there afterwards, whichever way the value went.
function amidMuch(v: any, a: number, b: number, c: number, d: number, s: string, t: string, list: number[]): string {
    const p = a * 1.5, q = b * 2.5, r = c + d, u = a - d, w = s + t, x = b * c, y = a / 4, z = d % 7, n = list.length, m = list[0] + a;
    const held: Point | undefined = v;
    const e = p + q, f = r * u, g = x - y;
    const text: string | undefined = hide(held ? w : undefined);
    const again: number[] | undefined = hide(held ? list : undefined);
    return [p, q, r, u, w, x, y, z, n, m, e, f, g, held ? held.x + held.y : "nothing", text, again ? again.length : -1].join(" ");
}
console.log(amidMuch(point, 1, 2, 3, 4, "s", "t", [9, 8]));
console.log(amidMuch(undefined, 5, 6, 7, 8, "u", "v", [7]));
console.log(amidMuch(null, 1.25, 2.5, 3.75, 4.5, "w", "x", marked));
for (const wrong of [hide(1), hide("text"), hide(named), hide([1]), hide(true)]) {
    try {
        console.log(amidMuch(wrong, 1, 2, 3, 4, "s", "t", [1]));
    } catch (error) {
        console.log("refused: " + (error instanceof TypeError));
    }
}

// Often, so that each way is gone many times, and what is made meanwhile is collected.
let sum = 0;
const mixed: any[] = [point, undefined, { x: 3, y: 4 } as Point, null, point];
for (let i = 0; i < 200000; i++) {
    const held = toPointOrNothing(mixed[i % mixed.length]);
    if (held) sum += held.x + held.y;
    const text = toTextOrNothing(i % 3 ? "t" + (i & 7) : undefined);
    if (text) sum += text.length;
    const list = toList(i % 5 ? marked : heir);
    sum += list.length;
}
console.log(sum);

// As values: the parameters are places too.
function area(p: Point, scale: number, label: string | undefined, extra: number[] | undefined): string {
    return (p.x * p.y * scale) + (label ?? "-") + (extra ? extra.length : 0);
}
const called: any = hide(area);
console.log(called(point, 2, "a", [1]), called(point, 0.5, undefined, undefined), called({ x: 5, y: 6 } as Point, 1, "b", marked));
for (const wrong of [[1, 1, "a", []], [point, "1", "a", []], [point, 1, 2, []], [point, 1, "a", {}], [undefined, 1, "a", []]]) {
    try {
        console.log(called(...wrong));
    } catch (error) {
        console.log("refused: " + (error instanceof TypeError));
    }
}
