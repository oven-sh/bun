// `{ ...object }` and `{ ...object, more }` where the object does not inherit from Object.prototype directly: objects of classes, of Object.create, without a prototype. The copy is a plain object with the own enumerable properties, in order.
const count = globalThis.aotOperationCount ?? (() => 0);
const operations = ["operationAOTCloneObject", "operationAOTCloneObjectAndExtend"];
const entered = () => operations.reduce((sum, name) => sum + count(name), 0);
const mark = Symbol("mark");
class Product {
  constructor(i) {
    this.id = i;
    this.name = "n" + i;
    this.price = i * 1.5;
    this.tags = ["a", i];
  }
  get label() {
    return this.name + "!";
  }
  method() {}
}
class Special extends Product {
  constructor(i) {
    super(i);
    this.special = true;
  }
}
class Empty {}
class Hidden {
  #secret = 1;
  shown = 2;
  #other = 3;
  last = 4;
  read() {
    return this.#secret + this.#other;
  }
}
class Branded {
  shown = 1;
  #method() {
    return 2;
  }
  call() {
    return this.#method();
  }
}
class Marked {
  constructor(i) {
    this.first = i;
    this[mark] = "m" + i;
    this.second = i + 1;
  }
}
const wide = n =>
  class {
    constructor(i) {
      for (let k = 0; k < n; k++) this["p" + k] = i + k;
    }
  };
const kinds = [
  ["an object of a class", i => new Product(i)],
  ["of a subclass", i => new Special(i)],
  ["of an empty class", () => new Empty()],
  ["with private fields", () => new Hidden()],
  ["with a private method", () => new Branded()],
  ["with a symbol", i => new Marked(i)],
  ["with 7 properties", i => new (wide(7))(i)],
  ["with 12 properties", i => new (wide(12))(i)],
  ["with 40 properties", i => new (wide(40))(i)],
  ["with 90 properties", i => new (wide(90))(i)],
  ["made by Object.create", i => Object.assign(Object.create({ inherited: 1 }), { a: i, b: "b" })],
  ["without a prototype", i => Object.assign(Object.create(null), { a: i, b: "b" })],
  ["with a property that is not enumerable", i => Object.defineProperty(new Product(i), "quiet", { value: 1, enumerable: false })],
  ["with a getter of its own", i => Object.defineProperty(new Product(i), "computed", { get() { return this.id * 2; }, enumerable: true })],
  ["with a read-only property", i => Object.defineProperty(new Product(i), "fixed", { value: 9, enumerable: true, writable: false })],
  ["frozen", i => Object.freeze(new Product(i))],
  ["sealed", i => Object.seal(new Product(i))],
  ["after a delete", i => { const made = new Product(i); delete made.name; made.late = 1; return made; }],
  ["with elements", i => { const made = new Product(i); made[0] = "zero"; made[2] = "two"; return made; }],
  ["whose prototype was replaced", i => Object.setPrototypeOf({ a: i, b: 2 }, Product.prototype)],
  ["an error", i => Object.assign(new Error("e" + i), { code: i })],
  ["an array", i => [i, i + 1]],
  ["a function with a property", i => Object.assign(() => 1, { own: i })],
  ["a map", () => new Map([[1, 2]])],
  ["a plain object", i => ({ id: i, name: "n" })],
];
const forms = [
  ["copied", s => ({ ...s })],
  ["and one", s => ({ ...s, extra: "x" })],
  ["and two", s => ({ ...s, extra: "x", more: null })],
  ["and a number", (s, i) => ({ ...s, extra: i * 0.5 })],
  ["one replaced", s => ({ ...s, name: "new", id: -1 })],
  ["one before", s => ({ before: 1, ...s })],
  ["twice", s => ({ ...s, ...s, end: 1 })],
];
const show = value => {
  const keys = Reflect.ownKeys(value);
  return keys.length + ":" + keys.slice(0, 9).map(key => String(key) + "=" + JSON.stringify(value[key])).join(",") + (keys.length > 9 ? ",.." + String(keys[keys.length - 1]) : "");
};
for (const [kind, make] of kinds) {
  for (const [form, spread] of forms) {
    let copy;
    for (let i = 0; i < 6; i++) copy = spread(make(i), i);
    const descriptors = Object.values(Object.getOwnPropertyDescriptors(copy));
    console.log(kind + ", " + form + ": " + show(copy), Object.getPrototypeOf(copy) === Object.prototype, Object.isExtensible(copy), descriptors.every(d => d.writable && d.enumerable && d.configurable && "value" in d));
  }
}
const source = new Product(1);
const copy = { ...source, extra: 1 };
copy.id = 100;
copy.added = 1;
console.log("the source stays", show(source), source instanceof Product, copy instanceof Product, String(copy.label), copy.tags === source.tags);
console.log("private fields stay", new Hidden().read(), Object.keys({ ...new Hidden() }).join());
const sources = Array.from({ length: 16 }, (_, i) => (i & 1 ? new Product(i) : new Special(i)));
let kept = 0;
const turn = n => {
  for (let i = 0; i < n; i++) {
    const s = sources[i & 15];
    kept += Object.keys({ ...s }).length + Object.keys({ ...s, extra: "x" }).length + Object.keys({ ...s, extra: "x", more: s }).length + Object.keys({ ...s, name: "y" }).length;
  }
};
turn(200);
const before = entered();
turn(5000);
console.log("many", kept, entered() - before < 500);
