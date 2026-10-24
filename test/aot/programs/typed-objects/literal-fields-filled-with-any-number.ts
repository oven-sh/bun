// An object literal, a spread with an override and a class field fill enum fields with numbers that are no int32. The object has its keys in the written order and every value as it was given,
// whether or not the field has a narrow slot, also when it is frozen at once.
declare const console: { log(...values: unknown[]): void };

enum Kind { A, B, C }
interface Item { kind: Kind; flags: Kind; name: string; next?: Item | null }
function make(k: Kind, f: Kind): Item { return { kind: k, flags: f, name: "n" }; }
function makeInOtherOrder(k: Kind, f: Kind): Item { return { name: "o", flags: f, kind: k }; }
function makeLinked(k: Kind, next: Item | null): Item { return { kind: k, flags: Kind.B, name: "l", next }; }
function override(base: Item, k: Kind): Item { return { ...base, kind: k }; }
function overrideFirst(base: Partial<Item>, k: Kind): Item { return { kind: k, name: "p", ...base, flags: k }; }
function makeFrozen(k: Kind): Readonly<Item> { return Object.freeze({ kind: k, flags: k, name: "f" }); }
class Holder { item: Item; own: Kind; constructor(k: Kind) { this.own = k; this.item = { kind: k, flags: this.own, name: "h" }; } }

function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
function typed(i: Item): string { return [i.kind, i.flags, i.kind === Kind.B, i.flags & 3, i.kind + 1, 1 / i.flags, i.name].map(show).join(" "); }
function untyped(u: any): string {
    const d = Object.getOwnPropertyDescriptor(u, "kind")!;
    return [Object.keys(u).join(), JSON.stringify(u), show(u.kind), show(u["fl" + "ags"]), d.writable, d.enumerable, d.configurable, Object.isFrozen(u)].join(" ");
}
function poke(target: any, name: string, value: unknown): void { target[name] = value; }

const names: string[] = JSON.parse('["kind","flags"]');
const numbers: number[] = JSON.parse("[0,-0,1,2,0.5,2147483647,2147483648,-2147483643,-2147483644,-2147483648,-2147483649,1e21,1e400]");
numbers.push(Number("x"));
let previous: Item | null = null;
for (const n of numbers) {
    const all: Item[] = [make(n, n), make(Kind.C, n), make(n, Kind.A), makeInOtherOrder(n, n), makeLinked(n, previous), override(make(1, 2), n), override(make(n, n), Kind.B), overrideFirst(make(n, 1), n), makeFrozen(n), new Holder(n).item];
    for (const each of all) console.log(typed(each), "|", untyped(each));
    previous = all[4];
    const changed = make(n, n);
    for (const name of names) poke(changed, name, 7);
    console.log(typed(changed), "|", untyped(changed));
    for (const name of names) poke(changed, name, n);
    console.log(typed(changed), "|", untyped(changed), show(new Holder(n).own), previous.next === null ? "first" : typed(previous.next!));
}
