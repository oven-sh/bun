// Objects of one type that were created with the first two to six of its members, in a hot loop: every one is written like plain Bun writes it.
declare const console: { log(...values: unknown[]): void };
interface Inner { x: number }
interface Sparse { id: number; name: string; note?: string; tag?: string; more?: string; last?: string }
interface Nested { inner: Inner; after?: number; end?: string }

function make(kind: number, i: number): Sparse {
    switch (kind) {
    case 0: return { id: i, name: "n" };
    case 1: return { id: i, name: "n", note: "o" };
    case 2: return { id: i, name: "n", note: "o", tag: "t" };
    case 3: return { id: i, name: "n", note: "o", tag: "t", more: "m" };
    case 4: return { id: i, name: "n", note: "o", tag: "t", more: "m", last: "l" };
    case 5: return { id: i, name: "n", note: undefined, tag: "t" };
    default: return { id: i, name: "n", note: "o", tag: undefined, more: undefined };
    }
}
function makeNested(kind: number, i: number): Nested {
    if (kind === 0) return { inner: { x: i } };
    if (kind === 1) return { inner: { x: i }, after: i + 1 };
    return { inner: { x: i }, after: i + 1, end: "e" };
}
function write(value: Sparse): string { return JSON.stringify(value); }
function writeNested(value: Nested): string { return JSON.stringify(value); }

const seen = new Set<string>();
let length = 0;
for (let i = 0; i < 4000; i++) {
    const text = write(make(i % 7, i & 1));
    length += text.length;
    seen.add(text);
    seen.add(writeNested(makeNested(i % 3, i & 1)));
}
const out: unknown[] = [length, ...[...seen].sort()];

const storedLater: Sparse = { id: 1, name: "n" };
storedLater.note = "later";
out.push(write(storedLater));
storedLater.more = "out of order";
out.push(write(storedLater));
delete storedLater.note;
out.push(write(storedLater));

const inherits: Sparse = Object.create({ note: "inherited", last: "inherited" }, {});
inherits.id = 2;
inherits.name = "own";
out.push(write(inherits));
const withPrototype: Sparse = { id: 3, name: "n" };
Object.setPrototypeOf(withPrototype, { note: "inherited" });
out.push(write(withPrototype));

const grows: Nested = { inner: { x: 1 } };
(grows.inner as any).toJSON = function () { grows.after = 5; return "grown"; };
out.push(writeNested(grows), writeNested(grows));
const shrinks: Nested = { inner: { x: 1 }, after: 2, end: "e" };
(shrinks.inner as any).toJSON = function () { delete shrinks.end; return "shrunk"; };
out.push(writeNested(shrinks), writeNested(shrinks));
const reordered: Nested = { inner: { x: 1 }, after: 2 };
(reordered.inner as any).toJSON = function () { delete reordered.after; reordered.end = "e"; reordered.after = 3; return "reordered"; };
out.push(writeNested(reordered), writeNested(reordered));
console.log(out.map(String).join("\n"));
