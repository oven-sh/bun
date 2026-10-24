// The fields of a typed object literal are deleted, turned into accessors, made read-only and frozen, its prototype is replaced; typed code reads and writes after each.
type Point = { x: number; y: number; label: string; next: Point | null };
function make(): Point {
  return { x: 1, y: 2, label: "p", next: null };
}
function read(point: Point): string {
  return point.x + " " + point.y + " " + point.label + " " + (point.next === null ? "null" : point.next === undefined ? "undefined" : point.next.label) + " [" + Object.keys(point).join() + "]";
}
function write(point: Point): string {
  try {
    point.x = 10;
    point.label = "q";
    point.next = make();
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const deleted = make();
delete (deleted as any).label;
delete (deleted as any).next;
console.log(read(deleted), write(deleted), read(deleted));

const withGetter = make();
let reads = 0;
Object.defineProperty(withGetter, "label", { get() { return "got" + ++reads; }, set(value) { reads += 100; }, enumerable: true, configurable: true });
console.log(read(withGetter), write(withGetter), read(withGetter), reads);

const readOnly = make();
Object.defineProperty(readOnly, "label", { writable: false });
console.log(read(readOnly), write(readOnly), read(readOnly));

const hidden = make();
Object.defineProperty(hidden, "next", { enumerable: false });
console.log(read(hidden), write(hidden), read(hidden), JSON.stringify(hidden));

const frozen = Object.freeze(make());
console.log(read(frozen), write(frozen), read(frozen), Object.isFrozen(frozen));

const sealed = Object.seal(make());
console.log(read(sealed), write(sealed), read(sealed), delete (sealed as any).missing);

const bare = make();
Object.setPrototypeOf(bare, null);
console.log(read(bare), write(bare), read(bare), Object.getPrototypeOf(bare));

const heir = make();
delete (heir as any).label;
Object.setPrototypeOf(heir, { label: "inherited", extra: 1 });
console.log(read(heir), (heir as any).extra, write(heir), read(heir));
