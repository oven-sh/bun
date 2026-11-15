const object: any = {};
Object.defineProperty(object, "a", {
  get: () => 1,
  set(this: any, value: number) {
    this.b = value;
  },
  configurable: true,
  enumerable: true,
});
object.a = 5;
const descriptor = Object.getOwnPropertyDescriptor(object, "a")!;
console.log(
  object.a,
  object.b,
  typeof descriptor.get,
  typeof descriptor.set,
  Object.getOwnPropertyDescriptor(object, "b")!.get,
  Object.getOwnPropertyDescriptors(object).a.enumerable,
);
console.log(
  object.__proto__ === Object.prototype,
  object.hasOwnProperty("a"),
  object.propertyIsEnumerable("a"),
  Object.prototype.isPrototypeOf(object),
  object.toString(),
  object.valueOf() === object,
  typeof object.toLocaleString(),
  Object.hasOwn(object, "b"),
);
object.__proto__ = null;
console.log(
  Object.getPrototypeOf(object),
  {
    get x() {
      return 2;
    },
  }.x,
  class {
    static get y() {
      return 3;
    }
  }.y,
);
Bun.gc(true);
