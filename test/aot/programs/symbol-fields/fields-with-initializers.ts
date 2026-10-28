// Fields under symbols that have initializers are defined in the order of the class body, in front of what the constructor stores, and a definition runs no setter of the base class.
export {};

const kBase = Symbol("base");
const kOwn = Symbol("own");
const kLate = Symbol("late");
const order: string[] = [];
function note<T>(text: string, value: T): T {
  order.push(text);
  return value;
}
class Base {
  set [kOwn](value: number) {
    order.push("setter " + value);
  }
  [kBase] = note("base", 1);
}
class Derived extends Base {
  name = note("name", "n");
  // @ts-ignore: the field takes the place of the accessor
  [kOwn] = note("own", 2);
  [kLate]: number;
  constructor() {
    super();
    this[kLate] = note("late", 3);
  }
  sum(): number {
    return this[kBase] * 100 + this[kOwn] * 10 + this[kLate];
  }
}
let total = 0;
const derived = new Derived();
for (let round = 0; round < 300; round++) total += derived.sum();
console.log(total, order.join(), Reflect.ownKeys(derived).map(String).join(), Object.hasOwn(derived, kOwn));
