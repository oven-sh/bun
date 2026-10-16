function memoizeOne<A extends object, T>(callback: (argument: A) => T): (argument: A) => T {
  const known = new Map<A, T>();
  return argument => {
    let value = known.get(argument);
    if (value === undefined) {
      value = callback(argument);
      known.set(argument, value);
    }
    return value;
  };
}
interface Rules {
  depth: number;
}
interface Factory {
  rules: Rules;
  make(kind: number): number;
  count: number;
}
let built = 0;
function rulesOf(): Rules {
  built++;
  return { depth: built };
}
function describe(factory: Factory): string {
  return factory.make(1) + "," + factory.rules.depth + "," + factory.count;
}
const described = memoizeOne(describe);

function lazy(): Factory {
  const made: Factory = {
    count: 5,
    get rules(): Rules {
      const value = { depth: this.count * 10 };
      Object.defineProperty(this, "rules", { value, writable: true, enumerable: true, configurable: true });
      return value;
    },
    make(kind) {
      this.count++;
      return kind + this.rules.depth;
    },
  };
  return made;
}
const one = lazy();
console.log(described(one), describe(one));
console.log(typeof Object.getOwnPropertyDescriptor(one, "rules")!.get, one.rules === one.rules, one.rules.depth);
one.rules = { depth: 3 };
console.log(describe(one), Object.keys(one).join());
const other = lazy();
console.log(other.rules === other.rules, described(other));
