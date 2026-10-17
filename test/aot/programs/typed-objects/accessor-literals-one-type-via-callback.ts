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
    get rules() {
      return rulesOf();
    },
    make(kind) {
      made.count++;
      return kind + made.rules.depth;
    },
    count: 0,
  };
  return made;
}
function withValue(): Factory {
  const made: Factory = {
    rules: rulesOf(),
    make(kind) {
      made.count++;
      return kind + made.rules.depth;
    },
    count: 0,
  };
  return made;
}
function withBoth(): Factory {
  let kept: Rules = { depth: 100 };
  const made: Factory = {
    get rules() {
      return kept;
    },
    set rules(value) {
      kept = { depth: value.depth * 2 };
    },
    make(kind) {
      made.count++;
      return kind + made.rules.depth;
    },
    count: 0,
  };
  return made;
}
const all = [withGetter(), withValue(), withBoth(), withGetter()];
for (const one of all) console.log(described(one));
for (const one of all) {
  try {
    one.rules = { depth: 7 };
    console.log("stored", one.rules.depth);
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
for (const one of all) console.log(describe(one));
