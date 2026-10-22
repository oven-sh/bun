// The fields of a constructor function have the types that the type it declares for `this` gives their names, and so have the names that are stored later through the types below it.
// Whatever else arrives in such a field, from untyped code, through a cast or by name, is read back by untyped code as it was stored.
declare const console: { log(...values: unknown[]): void };

const enum Kind { Unknown = 0, Leaf = 1, Branch = 2, Root = 300 }
const enum Flags { None = 0, Seen = 1 << 0, Marked = 1 << 3, Last = 1 << 30, All = -1 }

interface Item { kind: Kind; flags: Flags; pos: number; end: number; id: number; parent: Item; original: Item | undefined; label: string; ready: boolean; }
interface LeafItem extends Item { text: string; count: number; next: LeafItem | undefined; closed: boolean; }
interface BranchItem extends Item { children: Item[]; depth: number; }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] };

function ItemObject(this: Mutable<Item>, kind: Kind, pos: number, end: number) {
    this.pos = pos;
    this.end = end;
    this.kind = kind;
    this.id = 0;
    this.flags = Flags.None;
    this.parent = undefined!;
    this.original = undefined;
    this.label = "";
    this.ready = false;
}
const ItemConstructor = ItemObject as unknown as new (kind: Kind, pos: number, end: number) => Item;

let nextId = 0;
function create(kind: Kind, pos: number, end: number): Item { const item = new ItemConstructor(kind, pos, end); (item as Mutable<Item>).id = ++nextId; return item; }
function createLeaf(text: string, pos: number): LeafItem {
    const leaf = create(Kind.Leaf, pos, pos + text.length) as Mutable<LeafItem>;
    leaf.text = text; leaf.count = text.length; leaf.next = undefined; leaf.closed = false;
    return leaf;
}
function createBranch(children: Item[]): BranchItem {
    const branch = create(Kind.Branch, children.length ? children[0].pos : -1, children.length ? children[children.length - 1].end : -1) as Mutable<BranchItem>;
    branch.children = children; branch.depth = 1;
    for (const child of children) (child as Mutable<Item>).parent = branch;
    return branch;
}

function show(value: unknown): string {
    if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.length + "]" : "{" + Object.keys(value).join() + "}";
    return String(value);
}
function describe(item: Item): string {
    return [item.kind, item.flags, item.pos, item.end, item.id, item.parent, item.original, item.label, item.ready].map(show).join(" ");
}
function isMarked(item: Item): boolean { return (item.flags & Flags.Marked) !== 0; }
function mark(item: Item): void { (item as Mutable<Item>).flags |= Flags.Marked; }
function width(item: Item): number { return item.end - item.pos; }
function isLeaf(item: Item): item is LeafItem { return item.kind === Kind.Leaf; }
function kindName(item: Item): string { switch (item.kind) { case Kind.Leaf: return "leaf"; case Kind.Branch: return "branch"; case Kind.Root: return "root"; default: return "other"; } }
function total(item: Item): number { return isLeaf(item) ? item.count : (item as BranchItem).children.reduce((sum, child) => sum + total(child), 0); }

const a = createLeaf("one", 0), b = createLeaf("three", 4);
(a as Mutable<LeafItem>).next = b;
const root = createBranch([a, b]);
console.log(describe(a)); console.log(describe(b)); console.log(describe(root));
console.log(isMarked(a), width(a), kindName(a), kindName(root), total(root), a.next === b, b.next, a.parent === root, Object.keys(a).join());
mark(a); console.log(isMarked(a), a.flags, isMarked(b), b.flags);

const numbers: number[] = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483649, 4294967296, 9007199254740991, 1e300, 5e-324];
for (const n of numbers) {
    const item = create(n as Kind, n, n) as Mutable<Item>;
    item.flags = n as Flags; item.id = n;
    console.log(describe(item), isMarked(item), show(width(item)), kindName(item), show(item.flags | 0), show(item.pos + 1), show(-item.pos), item.pos === n, Object.is(item.end, n));
    item.flags |= Flags.Last; item.pos++; item.end -= 1;
    console.log(show(item.flags), show(item.pos), show(item.end));
}

const strangers: unknown[] = [undefined, null, true, "text", 10n, Symbol.iterator, {}, [1], () => 1, -0, 1.5];
const names = ["kind", "flags", "pos", "end", "id", "parent", "original", "label", "ready", "text", "count", "next", "closed"];
function storeByName(target: any, name: string, value: unknown): void { target[name] = value; }
function readByName(target: any, name: string): unknown { return target[name]; }
for (const value of strangers) {
    const leaf = createLeaf("leaf", 2);
    for (const name of names) storeByName(leaf, name, value);
    console.log(names.map(name => typeof readByName(leaf, name)).join(), names.every(name => Object.is(readByName(leaf, name), value)), Object.keys(leaf).length);
    const cast = createLeaf("cast", 3) as any;
    cast.kind = value; cast.flags = value; cast.pos = value; cast.parent = value; cast.label = value; cast.ready = value; cast.text = value; cast.count = value;
    console.log(Object.is(cast.kind, value), Object.is(cast.flags, value), Object.is(cast.pos, value), Object.is(cast.parent, value), Object.is(cast.label, value), Object.is(cast.ready, value), Object.is(cast.text, value), Object.is(cast.count, value));
    cast.kind = Kind.Leaf; cast.pos = 7; cast.flags = Flags.Seen; cast.parent = root; cast.label = "again"; cast.ready = true; cast.text = "back"; cast.count = 4;
    console.log(describe(cast), total(cast), (cast as LeafItem).text, Object.keys(cast).join());
}

const removed = createLeaf("removed", 1) as any;
delete removed.flags; delete removed.pos; delete removed.count; delete removed.parent;
console.log("flags" in removed, removed.flags, removed.pos, removed.count, removed.parent, Object.keys(removed).join());
removed.flags = 5; removed.count = 6; console.log(removed.flags, removed.count, Object.keys(removed).join());

const watched = createLeaf("watched", 1) as any; let reads = 0;
Object.defineProperty(watched, "flags", { get() { reads++; return 9; }, configurable: true, enumerable: true });
Object.defineProperty(watched, "count", { value: 1.5, writable: false, configurable: true, enumerable: false });
console.log(isMarked(watched), (watched as LeafItem).flags, reads, total(watched), Object.keys(watched).join());
try { "use strict"; (watched as Mutable<LeafItem>).count = 2; } catch (error) { console.log((error as Error).constructor.name); }
console.log(watched.count);

const frozen = Object.freeze(createLeaf("frozen", 1));
try { mark(frozen); } catch (error) { console.log((error as Error).constructor.name); }
try { (frozen as Mutable<LeafItem>).count = 99; } catch (error) { console.log((error as Error).constructor.name); }
console.log(frozen.flags, frozen.count, Object.isFrozen(frozen));

const bare = Object.create(ItemObject.prototype) as Mutable<Item>;
console.log(bare.kind, bare.flags, bare.parent, Object.keys(bare).length, bare instanceof ItemObject);
ItemObject.call(bare, Kind.Root, 1, 2); console.log(describe(bare), kindName(bare));
const plain = {} as Mutable<Item>; ItemObject.call(plain, Kind.Leaf, 3, 4); console.log(describe(plain), plain instanceof ItemObject);
console.log(JSON.stringify(a, (key, value) => key === "parent" || key === "next" ? undefined : value));
