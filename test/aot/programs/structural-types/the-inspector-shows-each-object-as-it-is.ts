interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class Reversed {
  y = 2;
  extra = "extra";
  x = 1;
}

class Computed {
  get x(): number {
    return 1;
  }
  y = 2;
}

class Sub extends Pair {
  z = 3;
}

const tag = Symbol("tag");

function show(label: string, p: Point): void {
  console.log(label + ": " + Bun.inspect(p).replaceAll("\n", " ").replaceAll(/ +/g, " "));
}

const wide = { a: "a", x: 1, nested: { deep: [1, 2] }, y: 2 };
const optional: Point & { z?: number } = { x: 1, y: 2, z: 3 };
delete optional.z;
const undefinedMember: Point & { z?: number } = { x: 1, y: 2, z: undefined };
const deletedField = new Pair();
const looseField: { x?: number } = deletedField;
delete looseField.x;
const withSymbol = { x: 1, [tag]: "t", y: 2 };
const withIndexes = { x: 1, 1: "one", y: 2, 0: "zero" };
const withMethods = { x: 1, y: 2, method() {}, arrow: () => {} };
const grown = Object.assign(new Pair(), { added: true });

show("a literal", { x: 1, y: 2 });
show("another order", { y: 2, x: 1 });
show("wider", wide);
show("an instance", new Pair());
show("a look-alike", new Reversed());
show("a subclass", new Sub());
show("a getter of a class", new Computed());
show("an own getter", { get x() { return 1; }, y: 2 });
show("an own setter", { set x(value: number) {}, y: 2 });
show("a pair of accessors", { get x() { return 1; }, set x(value: number) {}, y: 2 });
show("inherited", Object.create({ x: 1, y: 2 }));
show("no prototype", Object.assign(Object.create(null), { x: 1, y: 2 }));
show("frozen", Object.freeze({ x: 1, y: 2 }));
show("x is hidden", Object.defineProperty({ x: 1, y: 2 }, "x", { enumerable: false }));
show("a symbol key", withSymbol);
show("index keys", withIndexes);
show("an optional member deleted", optional);
show("an optional member undefined", undefinedMember);
show("a field deleted", deletedField);
show("a member added to an instance", grown);
show("special numbers", { x: -0, y: NaN });
show("a proxy", new Proxy({ x: 1, y: 2 }, {}));
show("methods", withMethods);

const list: Point[] = [{ x: 1, y: 2 }, new Pair(), new Reversed(), { y: 4, x: 3 }];
console.log("a list: " + Bun.inspect(list).replaceAll("\n", " ").replaceAll(/ +/g, " "));

class Holder {
  point: Point = new Reversed();
  points: Point[] = [new Pair()];
  #hidden = 1;
  peek(): number {
    return this.#hidden;
  }
}
console.log("fields: " + Bun.inspect(new Holder()).replaceAll("\n", " ").replaceAll(/ +/g, " "));

console.log({ y: 2, x: 1 });
console.log(new Reversed());
console.log("beside text", new Pair(), { x: 1, y: 2 });
console.log([new Sub()]);

export {};
