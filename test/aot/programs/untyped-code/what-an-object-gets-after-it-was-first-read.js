// An object is read, stored to and called through first, and only then gets an accessor, a deletion, copied properties or another prototype: whatever comes later sees it.
function readSize(box) {
  return box.size;
}
function storeSize(box, value) {
  box.size = value;
  return box.size;
}
function run(box) {
  return box.run();
}

const withGetterLater = { size: 1 };
console.log(readSize(withGetterLater));
Object.defineProperty(withGetterLater, "size", { get: () => "out of a getter", configurable: true });
console.log(readSize(withGetterLater));

const base = {};
const heir = Object.create(base);
console.log(storeSize(Object.create(base), 2));
const taken = [];
Object.defineProperty(base, "size", {
  get() {
    return "the setter took " + taken.join();
  },
  set(value) {
    taken.push(value, this === heir);
  },
});
console.log(storeSize(heir, 3), Object.hasOwn(heir, "size"));

const above = { size: "from above" };
const below = Object.create(above);
below.size = "its own";
console.log(readSize(below));
delete below.size;
console.log(readSize(below));

const target = {};
console.log(readSize(target));
Object.assign(target, { size: "copied" });
console.log(readSize(target));
const filledBySpread = { ...{ get size() { return "read while it was copied"; } } };
console.log(readSize(filledBySpread), typeof Object.getOwnPropertyDescriptor(filledBySpread, "size").get);

const orphan = {};
console.log(readSize(orphan));
Object.setPrototypeOf(orphan, { size: "from the new prototype" });
console.log(readSize(orphan));
const adopted = { __proto__: null };
console.log(readSize(adopted));
Object.setPrototypeOf(adopted, withGetterLater);
console.log(readSize(adopted));

const worker = {
  run() {
    return "the first method";
  },
};
console.log(run(worker));
Object.defineProperty(worker, "run", { get: () => () => "a method out of a getter", configurable: true });
console.log(run(worker));
delete worker.run;
Object.setPrototypeOf(worker, {
  run() {
    return "a method of the new prototype, this is the worker: " + (this === worker);
  },
});
console.log(run(worker));

class Shape {
  static describe() {
    return "a shape";
  }
}
class Circle extends Shape {}
console.log(Circle.describe());
Object.setPrototypeOf(Circle, {
  describe() {
    return "no shape any more";
  },
});
console.log(Circle.describe());

const list = [1, 2, 3];
console.log(list.map(x => x * 2).join());
Object.defineProperty(list, "map", { get: () => () => ["its own map"] });
console.log(list.map(x => x * 2).join());
