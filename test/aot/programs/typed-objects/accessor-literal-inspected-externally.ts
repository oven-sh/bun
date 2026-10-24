// An object literal with a getter, known to the rest of the program through an interface, is looked at from outside: keys, descriptors, a spread, Object.assign, for..in.
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

function withGetter(): Factory {
  const made: Factory = {
    count: 0,
    get rules() {
      return rulesOf();
    },
    make(kind) {
      made.count++;
      return kind + made.rules.depth;
    },
  };
  return made;
}
const one = withGetter();
console.log(described(one));
console.log(Object.keys(one).join(), JSON.stringify(one), Object.entries(one).length);
const descriptor = Object.getOwnPropertyDescriptor(one, "rules")!;
console.log(
  typeof descriptor.get,
  descriptor.set,
  descriptor.enumerable,
  descriptor.configurable,
  "value" in descriptor,
);
const spread: Factory = { ...one };
console.log(Object.getOwnPropertyDescriptor(spread, "rules")!.value.depth, described(spread));
const assigned = Object.assign({}, one) as Factory;
console.log(typeof Object.getOwnPropertyDescriptor(assigned, "rules")!.get, assigned.rules.depth, described(assigned));
for (const key in one) console.log(key);
console.log("rules" in one, Object.hasOwn(one, "rules"), built);
