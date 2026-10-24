interface Address { street: string; city: string }
interface Order { id: number; total: number; paid: boolean }
interface Customer { id: number; name: string; address: Address; tags: string[]; orders: Order[]; note: string | null }
interface Item { id?: number; title?: string; price?: number; stock: number | null; hidden?: boolean; parent?: Item | null }
interface Numbers { a: number; b: number; c: number; d: number }
interface Flags { yes: boolean; no: boolean; maybe?: boolean }
interface Link { value: number; next: Link | null }
interface Tree { name: string; children: Tree[] }
interface Kinds { kind: "circle" | "square"; size: 1 | 2 | 3; label: string }
interface Mixed { either: string | number; any: unknown; list: (string | null)[]; matrix: number[][] }
interface Empty {}
interface OnlyOptional { a?: number; b?: string; c?: boolean }

function hide(value: unknown): any {
    return value;
}

function show(label: string, make: () => unknown) {
    try {
        console.log(label, String(make()));
    } catch (error) {
        console.log(label, "throws", (error as Error).constructor.name, (error as Error).message);
    }
}

function customer(i: number): Customer {
    return { id: i, name: "customer " + i, address: { street: i + " Main Street", city: "Springfield" }, tags: ["a" + i, "b"], orders: [{ id: i * 2, total: 10.5 + i, paid: true }, { id: i * 2 + 1, total: 99 + i, paid: false }], note: i & 1 ? null : "note " + i };
}

show("customer", () => JSON.stringify(customer(1)));
show("customer", () => JSON.stringify(customer(2)));
show("customers", () => JSON.stringify([customer(3), customer(4)]));
show("no customers", () => JSON.stringify(((): Customer[] => ([]))()));

const withoutOrders = customer(5);
withoutOrders.orders = [];
withoutOrders.tags = [];
show("empty lists", () => JSON.stringify(withoutOrders));

function item(bits: number): Item {
    const made: Item = { stock: bits & 2 ? null : bits * 3 };
    if (bits & 1) made.title = "item " + bits;
    if (bits & 4) made.price = bits + 0.25;
    if (bits & 8) made.hidden = false;
    if (bits & 16) made.id = bits;
    if (bits & 32) made.parent = bits & 64 ? null : item(bits & 15);
    return made;
}
for (let bits = 0; bits < 128; bits += 5) show("item " + bits, () => JSON.stringify(item(bits)));

const inAnotherOrder: Item = { hidden: true, stock: 1 };
inAnotherOrder.price = 2;
inAnotherOrder.title = "t";
inAnotherOrder.id = 3;
show("another order", () => JSON.stringify(inAnotherOrder));

const setToUndefined: Item = { id: 1, title: undefined, price: undefined, stock: 2, hidden: undefined, parent: undefined };
show("undefined members", () => JSON.stringify(setToUndefined));
const afterDelete = item(31);
delete afterDelete.title;
show("after delete", () => JSON.stringify(afterDelete));
afterDelete.title = "again";
show("created again", () => JSON.stringify(afterDelete));

const numbers: Numbers[] = [
    { a: 0, b: -0, c: 1, d: -1 },
    { a: NaN, b: Infinity, c: -Infinity, d: 0.1 },
    { a: 2147483647, b: -2147483648, c: 2147483648, d: -2147483649 },
    { a: 1e21, b: 1e-7, c: 123456789012345680000, d: 5e-324 },
    { a: 9007199254740991, b: -9007199254740991, c: 1.7976931348623157e308, d: 4294967295 },
    { a: 0.5, b: 1073741823, c: -1073741824, d: -1073741825 },
    { a: 1 / 3, b: 100, c: 1e3, d: 12345.678 },
];
for (const each of numbers) show("numbers", () => JSON.stringify(each));
show("all numbers", () => JSON.stringify(numbers));

show("flags", () => JSON.stringify(((): Flags => ({ yes: true, no: false }))()));
show("flags", () => JSON.stringify(((): Flags => ({ yes: false, no: true, maybe: true }))()));
show("flags", () => JSON.stringify(((): Flags => ({ yes: false, no: true, maybe: undefined }))()));

const texts = ["", "a", "ab", "abc", "abcd", "abcdefg", "abcdefgh", "abcdefghijklmno", "abcdefghijklmnop", "abcdefghijklmnopqrstuvwxyz0123456789", "quote \" here", "back \\ slash", "line\nbreak", "tab\t", "\u0000\u0001\u001f", "del \u007f", "latin éÿ", "wide Ж中", "pair 😀", "lone \ud800 high", "lone \udc00 low", "  ", "x".repeat(70) + "\"", "y".repeat(5000)];
for (const text of texts) show("text", () => JSON.stringify(((): Address => ({ street: text, city: text + text }))()));
show("rope", () => JSON.stringify(((): Address => ({ street: texts[7] + texts[8] + texts[9], city: texts[3] + 1 }))()));
show("texts", () => JSON.stringify(((): Customer => ({ id: 1, name: "n", address: { street: "s", city: "c" }, tags: texts, orders: [], note: null }))()).length);

let chain: Link | null = null;
for (let i = 0; i < 6; i++) chain = { value: i, next: chain };
show("chain", () => JSON.stringify(chain));
let longChain: Link | null = null;
for (let i = 0; i < 3000; i++) longChain = { value: i, next: longChain };
show("long chain", () => JSON.stringify(longChain)!.length);
const cycle: Link = { value: 1, next: null };
cycle.next = { value: 2, next: cycle };
show("cycle", () => JSON.stringify(cycle));
const ownCycle: Link = { value: 1, next: null };
ownCycle.next = ownCycle;
show("own cycle", () => JSON.stringify(ownCycle));

function tree(depth: number, width: number): Tree {
    const made: Tree = { name: "d" + depth, children: [] };
    for (let i = 0; depth && i < width; i++) made.children.push(tree(depth - 1, width));
    return made;
}
show("tree", () => JSON.stringify(tree(4, 2)));
const cyclicTree = tree(2, 2);
cyclicTree.children[1].children.push(cyclicTree);
show("cyclic tree", () => JSON.stringify(cyclicTree));

show("kinds", () => JSON.stringify(((): Kinds => ({ kind: "circle", size: 2, label: "l" }))()));
show("kinds", () => JSON.stringify(((): Kinds[] => ([{ kind: "square", size: 3, label: "m" }, { kind: "circle", size: 1, label: "" }]))()));

show("mixed", () => JSON.stringify(((): Mixed => ({ either: "text", any: { deep: [1, "two", null, { three: 3 }] }, list: ["a", null, "b"], matrix: [[1, 2], [], [3.5]] }))()));
show("mixed", () => JSON.stringify(((): Mixed => ({ either: 7, any: undefined, list: [], matrix: [] }))()));
show("mixed", () => JSON.stringify(((): Mixed => ({ either: 7.5, any: () => 1, list: [null], matrix: [[0]] }))()));
show("mixed", () => JSON.stringify(((): Mixed => ({ either: "", any: Symbol("s"), list: [], matrix: [[-0, NaN]] }))()));
show("mixed", () => JSON.stringify(((): Mixed => ({ either: "", any: 10n, list: [], matrix: [] }))()));
show("mixed", () => JSON.stringify(((): Mixed => ({ either: "", any: new Date(0), list: [], matrix: [] }))()));
show("mixed", () => JSON.stringify(((): Mixed => ({ either: "", any: new Map([[1, 2]]), list: [], matrix: [] }))()));

show("empty", () => JSON.stringify(((): Empty => ({}))()));
show("only optional", () => JSON.stringify(((): OnlyOptional => ({}))()));
show("only optional", () => JSON.stringify(((): OnlyOptional => ({ b: "b" }))()));
show("only optional", () => JSON.stringify(((): OnlyOptional => ({ c: true, a: 1 }))()));
show("only optional", () => JSON.stringify(((): OnlyOptional => ({ a: undefined, b: undefined, c: false }))()));
show("only optional", () => JSON.stringify(((): OnlyOptional => ({ a: undefined, b: undefined, c: undefined }))()));

const sparse: Order[] = [{ id: 1, total: 1, paid: true }];
sparse[3] = { id: 4, total: 4, paid: false };
show("holes", () => JSON.stringify(sparse));
const sparseNumbers: number[][] = [[1, 2, 3]];
sparseNumbers[0][5] = 6;
show("holes among numbers", () => JSON.stringify(((): Mixed => ({ either: 0, any: 0, list: [], matrix: sparseNumbers }))()));
const strangers: Order[] = [{ id: 1, total: 1, paid: true }];
hide(strangers).push(null, undefined, 5, "text", { other: 1 }, [1], () => 1, Symbol("s"));
show("strangers in a list", () => JSON.stringify(strangers));
const named: Order[] = [{ id: 1, total: 1, paid: true }];
hide(named).extra = 1;
show("a list with a name", () => JSON.stringify(named));
const listWithToJSON: Order[] = [{ id: 1, total: 1, paid: true }];
hide(listWithToJSON).toJSON = () => "list";
show("a list with toJSON", () => JSON.stringify(((): Customer => ({ id: 1, name: "n", address: { street: "s", city: "c" }, tags: [], orders: listWithToJSON, note: null }))()));

const withExtra = customer(6);
hide(withExtra).extra = 1;
show("an extra property", () => JSON.stringify(withExtra));
const withExtraInside = customer(7);
hide(withExtraInside.address).extra = 1;
show("an extra property inside", () => JSON.stringify(withExtraInside));
const withOwnToJSON = customer(8);
hide(withOwnToJSON.address).toJSON = () => "address";
show("toJSON inside", () => JSON.stringify(withOwnToJSON));
const withGetter = customer(9);
Object.defineProperty(hide(withGetter.orders[0]), "more", { get: () => "got", enumerable: true });
show("a getter inside", () => JSON.stringify(withGetter));
const frozen: Customer = Object.freeze(hide(customer(10)));
show("frozen", () => JSON.stringify(frozen));
const sealedInside = customer(11);
Object.seal(hide(sealedInside.address));
show("sealed inside", () => JSON.stringify(sealedInside));

const plainAsCustomer = JSON.parse(JSON.stringify(customer(12))) as Customer;
show("parsed", () => JSON.stringify(plainAsCustomer));
const perhaps: (Customer | undefined | null)[] = [undefined, null, customer(21)];
for (const each of perhaps) show("perhaps", () => JSON.stringify(each));

const large: Order[] = [];
for (let i = 0; i < 20000; i++) large.push({ id: i, total: i / 4, paid: i % 3 === 0 });
show("large", () => {
    const text = JSON.stringify(large);
    return text.length + " " + text.slice(-60);
});
show("small again", () => JSON.stringify(large[7]));

const withPrototype = customer(13);
Object.setPrototypeOf(hide(withPrototype), { toJSON: () => "from the prototype" });
show("toJSON on a prototype", () => JSON.stringify(withPrototype));
show("toJSON on a prototype, in a list", () => JSON.stringify([customer(14), withPrototype]));
const withPrototypeInside = customer(15);
Object.setPrototypeOf(hide(withPrototypeInside.address), { toJSON: () => "address from the prototype" });
Object.setPrototypeOf(hide(withPrototypeInside.orders[1]), { toJSON: () => "order from the prototype" });
show("toJSON on a prototype inside", () => JSON.stringify(withPrototypeInside));
const withoutPrototype = customer(16);
Object.setPrototypeOf(hide(withoutPrototype), null);
Object.setPrototypeOf(hide(withoutPrototype.address), null);
show("no prototype", () => JSON.stringify(withoutPrototype));
const inheriting = customer(17);
Object.setPrototypeOf(hide(inheriting.address), { inherited: 1 });
show("an inherited property is not written", () => JSON.stringify(inheriting));
class AddressWithToJSON implements Address {
    constructor(public street: string, public city: string) {}
    toJSON(): string {
        return this.street + ", " + this.city;
    }
}
class PlainAddress implements Address {
    constructor(public street: string, public city: string) {}
    get both(): string {
        return this.street + this.city;
    }
}
const withInstances = customer(18);
withInstances.address = new AddressWithToJSON("1 Class Street", "Classville");
show("an object of a class with toJSON", () => JSON.stringify(withInstances));
withInstances.address = new PlainAddress("2 Class Street", "Classville");
show("an object of a class", () => JSON.stringify(withInstances));
show("as at first", () => JSON.stringify(customer(19)));
