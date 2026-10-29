// `Object.assign(Object.create(Object.getPrototypeOf(x)), x)` is the idiom for a copy of x that keeps its prototype. Of an object with a layout the copy is made with the same layout, unless the three calls could be told from that.
// CALLS+ Reason.annotate TryCloneWithPrototype
// CALLS+ Point.moved TryCloneWithPrototype
// CALLS+ renamed TryCloneWithPrototype
// CALLS+ changed TryCloneWithPrototype
// CALLS- ofAnother TryCloneWithPrototype
// CALLS- byReflect TryCloneWithPrototype
// CALLS- kept TryCloneWithPrototype
abstract class Reason<Tag extends string> {
  readonly tag: Tag;
  readonly notes: ReadonlyMap<string, unknown>;
  constructor(tag: Tag, notes: ReadonlyMap<string, unknown>) {
    this.tag = tag;
    this.notes = notes;
  }
  annotate(notes: ReadonlyMap<string, unknown>): this {
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.notes = notes;
    return self;
  }
  abstract weight(): number;
}
class Fail extends Reason<"Fail"> {
  readonly error: number;
  constructor(error: number, notes: ReadonlyMap<string, unknown>) {
    super("Fail", notes);
    this.error = error;
  }
  weight(): number { return this.error + this.notes.size + this.tag.length; }
}
class Point {
  x: number;
  y: number;
  owner: Point | undefined;
  constructor(x: number, y: number, owner: Point | undefined) {
    this.x = x;
    this.y = y;
    this.owner = owner;
  }
  moved(x: number): Point {
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.x = x;
    return self;
  }
}
interface Row { id: number; name: string; next?: Row }
function renamed(row: Row, name: string): Row {
  const self = Object.assign(Object.create(Object.getPrototypeOf(row)), row);
  self.name = name;
  return self;
}
function changed(row: Row, changes: Partial<Row>): Row {
  return Object.assign(Object.create(Object.getPrototypeOf(row)), row, changes);
}
function ofAnother(row: Row, other: Row): Row {
  return Object.assign(Object.create(Object.getPrototypeOf(other)), row);
}
function byReflect(row: Row): Row {
  return Object.assign(Object.create(Reflect.getPrototypeOf(row)), row);
}
function kept(row: Row): [Row, object] {
  const empty = Object.create(Object.getPrototypeOf(row));
  return [Object.assign(empty, row), empty];
}
function copyOf(value: any): any {
  return Object.assign(Object.create(Object.getPrototypeOf(value)), value);
}
function describe(value: any): string {
  const names = Reflect.ownKeys(value).map((key) => `${String(key)}=${String(value[key])}`);
  return `${Object.getPrototypeOf(value) === null ? "null" : Object.getPrototypeOf(value).constructor.name} {${names.join()}} ${Object.isFrozen(value)} ${Object.isExtensible(value)}`;
}
function attempt(name: string, run: () => unknown): void {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, "threw", (error as Error).constructor.name);
  }
}

const empty: ReadonlyMap<string, unknown> = new Map();
const one: ReadonlyMap<string, unknown> = new Map([["a", 1]]);
const fail = new Fail(3, empty);
const annotated = fail.annotate(one);
console.log("class", annotated !== fail, annotated instanceof Fail, annotated instanceof Reason, describe(annotated), annotated.weight(), fail.weight(), fail.notes === empty);
console.log("again", describe(annotated.annotate(empty)), annotated.notes === one);

const origin = new Point(1.5, 2, undefined);
const point = new Point(3.25, 4, origin);
const other = point.moved(9.75);
console.log("numbers", describe(other), point.x, other.x, other.owner === origin);
other.y = 0.5;
console.log("apart", point.y, other.y);

const first: Row = { id: 1, name: "a" };
const second: Row = { id: 2, name: "b", next: first };
console.log("record", describe(renamed(second, "c")), second.name, renamed(second, "c").next === first);
console.log("absent", describe(renamed(first, "d")), "next" in renamed(first, "d"));
console.log("changes", describe(changed(second, { id: 7 })), describe(changed(first, { next: second, name: "e" })), second.id);
console.log("another", describe(ofAnother(first, second)), describe(byReflect(second)));
const [filled, same] = kept(second);
console.log("kept", filled === same, describe(filled));

const withMore: any = { id: 3, name: "m" } as Row;
withMore.extra = "x";
withMore[Symbol.for("s")] = "y";
withMore[5] = "z";
console.log("more", describe(copyOf(withMore)), describe(renamed(withMore, "n")));
const withGetter: any = { id: 4, name: "g" } as Row;
let reads = 0;
Object.defineProperty(withGetter, "late", { get() { return ++reads; }, enumerable: true, configurable: true });
console.log("getter", describe(copyOf(withGetter)), reads, Object.getOwnPropertyDescriptor(copyOf(withGetter), "late")!.get === undefined);
const withHidden: any = { id: 5, name: "h" } as Row;
Object.defineProperty(withHidden, "secret", { value: 1, enumerable: false });
console.log("hidden", describe(copyOf(withHidden)));
const withoutName: any = { id: 6, name: "k" } as Row;
delete withoutName.name;
console.log("deleted", describe(copyOf(withoutName)));

const frozen = Object.freeze(new Point(1, 2, undefined));
const thawed = frozen.moved(8);
console.log("frozen", describe(frozen), describe(thawed));
const sealed: Row = Object.seal({ id: 8, name: "s" });
console.log("sealed", describe(renamed(sealed, "t")), Object.isSealed(renamed(sealed, "t")));

class Vault {
  #key = 7;
  open = 1;
  static holds(value: object): boolean { return #key in value; }
  copy(): Vault { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }
  key(): number { return this.#key; }
}
const vault = new Vault();
console.log("private", Vault.holds(vault), Vault.holds(vault.copy()), describe(vault.copy()));
attempt("private read", () => vault.copy().key());

const stored: unknown[] = [];
class Watched {
  set seen(value: unknown) { stored.push(value); }
}
class Watcher extends Watched {
  copy(): Watcher { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }
}
const watcher = new Watcher();
Object.defineProperty(watcher, "seen", { value: "own", enumerable: true, writable: true, configurable: true });
console.log("setter", describe(watcher.copy()), stored.join());
class Fixed {
  size = 1;
  copy(): Fixed { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }
}
const fixed = new Fixed();
console.log("writable", describe(fixed.copy()));
Object.defineProperty(Fixed.prototype, "size", { value: 0, writable: false, configurable: true });
attempt("read-only on the prototype", () => describe(fixed.copy()));
delete (Fixed.prototype as any).size;
console.log("writable again", describe(fixed.copy()));

const named: any = { id: 9, name: "p", ["__proto__"]: { marked: true } };
console.log("__proto__", Object.keys(named).join(), Object.keys(copyOf(named)).join(), copyOf(named).marked);

const bare: any = Object.assign(Object.create(null), { id: 10 });
console.log("null prototype", describe(copyOf(bare)));
const adopted: Row = { id: 11, name: "q" };
Object.setPrototypeOf(adopted, Point.prototype);
console.log("adopted", describe(renamed(adopted, "r")), renamed(adopted, "r") instanceof Point);
function moving(row: Row): Row {
  return Object.assign(Object.create(Object.getPrototypeOf(row)), row, (Object.setPrototypeOf(row, Fail.prototype), { id: 12 }));
}
const mover: Row = { id: 0, name: "v" };
console.log("prototype changed between", describe(moving(mover)), describe(mover));

console.log("array", Array.isArray(copyOf([1, 2])), describe(copyOf([1, 2])));
console.log("primitives", describe(copyOf(5)), describe(copyOf("ab")), describe(copyOf(true)));
attempt("undefined", () => copyOf(undefined));
attempt("null", () => copyOf(null));
const trapped: string[] = [];
const proxy = new Proxy({ a: 1 }, {
  getPrototypeOf(target) { trapped.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
  ownKeys(target) { trapped.push("ownKeys"); return Reflect.ownKeys(target); },
  get(target, key, receiver) { trapped.push(`get ${String(key)}`); return Reflect.get(target, key, receiver); },
});
console.log("proxy", describe(copyOf(proxy)), trapped.join());
const error = new RangeError("far");
(error as any).code = 1;
console.log("error", copyOf(error) instanceof RangeError, Object.keys(copyOf(error)).join(), copyOf(error).message);

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += new Fail(i, empty).annotate(one).weight() + point.moved(i).x + renamed(second, "w").id + changed(first, { id: i }).id;
}
console.log("many", total);
