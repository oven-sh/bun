// The base class and a subclass store under the same symbol: one field. Another subclass has a getter under it, and a third a method.
export {};

const kValue = Symbol("value");
class Base {
  [kValue]: number | (() => number);
  constructor(value: number) {
    this[kValue] = value;
  }
}
class Doubles extends Base {
  constructor(value: number) {
    super(value);
    this[kValue] = value * 2;
  }
}
class Plain {
  get [kValue](): number {
    return 7;
  }
}
class Method {
  [kValue](): number {
    return 9;
  }
}
function read(object: Base | Plain | Method): number {
  const value = object[kValue];
  return typeof value === "function" ? value.call(object) : value;
}
const all = [new Base(1), new Doubles(1), new Plain(), new Method()];
let total = 0;
for (let round = 0; round < 300; round++) for (const each of all) total += read(each);
console.log(
  total,
  all.map(each => Object.getOwnPropertySymbols(each).length).join(),
  all.map(each => kValue in each).join(),
);
Object.defineProperty(all[3], kValue, { value: 100, writable: true, configurable: true, enumerable: true });
(all[0] as Base)[kValue] = () => 1000;
console.log(all.map(read).join());
