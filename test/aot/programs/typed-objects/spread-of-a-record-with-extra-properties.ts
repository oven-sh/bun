// `{ ...p }` where p is a typed record that was given properties its type does not have: the copy has them too, in the same order, and shares nothing with p. Every kind of extra property that cannot be copied word by word is here as well.
interface Point {
  x: number;
  y: number;
  name: string;
  weight?: number;
}

function make(i: number): Point {
  return { x: i, y: i + 0.5, name: "p" + i };
}

function mark(p: Point, names: string[], from: number): Point {
  const open = p as unknown as Record<string, unknown>;
  for (let i = 0; i < names.length; i++) open[names[i]!] = from + i;
  return p;
}

function copy(p: Point): Point {
  return { ...p };
}

function copyAndSet(p: Point, x: number): Point {
  return { ...p, x };
}

function show(p: Point): string {
  return Object.keys(p).join() + " " + JSON.stringify(p);
}

const one = mark(make(1), ["mark"], 10);
let kept: Point = one;
let sum = 0;
for (let i = 0; i < 300; i++) {
  kept = copy(one);
  sum += kept.x + (kept as unknown as { mark: number }).mark;
}
console.log(sum, show(kept), kept === one);

(kept as unknown as { mark: number }).mark = 99;
kept.x = 7;
console.log(show(one), show(kept));
(one as unknown as { mark: number }).mark = 11;
console.log(show(one), show(kept), show(copy(kept)), show(copy(copy(one))));

for (const count of [2, 3, 5, 6, 7, 9, 20]) {
  const names: string[] = [];
  for (let i = 0; i < count; i++) names.push("extra" + i);
  const many = mark(make(count), names, 100);
  let last = many;
  for (let i = 0; i < 40; i++) last = copy(many);
  console.log(count, show(last) === show(many), Object.keys(last).length, (last as unknown as Record<string, number>)["extra" + (count - 1)]);
}

const changed = mark(make(2), ["mark"], 20);
for (let i = 0; i < 40; i++) kept = copyAndSet(changed, i);
console.log(show(kept), show(changed));

const large = mark(make(3), ["mark"], 30);
large.x = 2 ** 31 + 0.25;
large.y = -(2 ** 30) - 5;
for (let i = 0; i < 40; i++) kept = copy(large);
large.x = 1;
console.log(show(kept), show(large));

const optional = mark(make(4), ["mark"], 40);
optional.weight = 3;
for (let i = 0; i < 40; i++) kept = copy(optional);
console.log(show(kept));
const optionalFirst = make(5);
optionalFirst.weight = 4;
mark(optionalFirst, ["mark"], 50);
for (let i = 0; i < 40; i++) kept = copy(optionalFirst);
console.log(show(kept));

const symbol = Symbol("tag");
const tagged = mark(make(6), ["mark"], 60);
(tagged as unknown as Record<symbol, unknown>)[symbol] = "s";
for (let i = 0; i < 40; i++) kept = copy(tagged);
console.log(show(kept), (kept as unknown as Record<symbol, unknown>)[symbol], Object.getOwnPropertySymbols(kept).length);

const hidden = mark(make(7), ["mark"], 70);
Object.defineProperty(hidden, "secret", { value: 1, enumerable: false, writable: true, configurable: true });
for (let i = 0; i < 40; i++) kept = copy(hidden);
console.log(show(kept), "secret" in kept, "secret" in hidden);

let reads = 0;
const computed = mark(make(8), ["mark"], 80);
Object.defineProperty(computed, "now", { get() { return ++reads; }, enumerable: true, configurable: true });
for (let i = 0; i < 40; i++) kept = copy(computed);
console.log(show(kept), reads, Object.getOwnPropertyDescriptor(kept, "now")!.writable);

const indexed = mark(make(9), ["mark", "0", "7"], 90);
for (let i = 0; i < 40; i++) kept = copy(indexed);
console.log(show(kept));

const shrunk = mark(make(10), ["first", "second", "third"], 100);
delete (shrunk as unknown as Record<string, unknown>).second;
for (let i = 0; i < 40; i++) kept = copy(shrunk);
console.log(show(kept));
delete (shrunk as unknown as Record<string, unknown>).first;
delete (shrunk as unknown as Record<string, unknown>).third;
for (let i = 0; i < 40; i++) kept = copy(shrunk);
console.log(show(kept));

for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
  const closed = mark(make(11), ["mark"], 110);
  for (let i = 0; i < 40; i++) kept = copy(closed);
  close(closed);
  for (let i = 0; i < 40; i++) kept = copy(closed);
  (kept as unknown as Record<string, unknown>).late = 1;
  kept.x = 5;
  console.log(show(kept), Object.isFrozen(kept), Object.isSealed(kept), Object.isExtensible(kept));
}

const holder = mark(make(12), ["mark"], 120);
(holder as unknown as Record<string, unknown>).inner = { deep: [1, 2] };
(holder as unknown as Record<string, unknown>).text = "t".repeat(3);
const copies: Point[] = [];
for (let i = 0; i < 5000; i++) {
  copies.push(copy(holder));
  if (i % 1000 === 999) copies.length = 10;
}
console.log(copies.length, show(copies[9]!), (copies[3] as unknown as { inner: unknown }).inner === (holder as unknown as { inner: unknown }).inner);

const bare = Object.setPrototypeOf(mark(make(13), ["mark"], 130), null) as Point;
for (let i = 0; i < 40; i++) kept = copy(bare);
console.log(show(kept), Object.getPrototypeOf(kept) === Object.prototype);
