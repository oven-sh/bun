// Symbols that are no constants of the program keep working as keys: made in a function or a loop, Symbol.for, a key whose type is a union of two unique symbols, well-known symbols.
function make(text: string) {
  const local = Symbol(text);
  class Tagged {
    [local]: number = 1;
    get(): number {
      return this[local];
    }
  }
  return { local, Tagged };
}
const one = make("x");
const two = make("x");
const a = new one.Tagged();
const b = new two.Tagged();
console.log(a.get(), b.get(), one.local === two.local, (a as any)[two.local], (b as any)[two.local]);
console.log(Object.getOwnPropertySymbols(a)[0] === one.local, Object.getOwnPropertySymbols(b)[0] === two.local);

const kFor = Symbol.for("shared");
const kForAgain = Symbol.for("shared");
class Registered {
  [kFor]: number = 3;
}
const registered = new Registered();
console.log(registered[kFor], (registered as any)[kForAgain], (registered as any)[Symbol.for("shared")], Symbol.keyFor(Object.getOwnPropertySymbols(registered)[0]));

const kOne = Symbol("one");
const kTwo = Symbol("two");
interface Pair {
  [kOne]: number;
  [kTwo]: number;
}
function pick(pair: Pair, key: typeof kOne | typeof kTwo): number {
  return pair[key];
}
function put(pair: Pair, key: typeof kOne | typeof kTwo, value: number) {
  pair[key] = value;
}
const pair: Pair = { [kOne]: 1, [kTwo]: 2 };
put(pair, kTwo, 20);
console.log(pick(pair, kOne), pick(pair, kTwo));

for (let i = 0; i < 2; i++) {
  const looped = Symbol("looped");
  const holder = { [looped]: i };
  console.log(holder[looped], Object.getOwnPropertySymbols(holder)[0] === looped);
}

class Iterable {
  items = [1, 2, 3];
  *[Symbol.iterator]() {
    yield* this.items;
  }
  get [Symbol.toStringTag]() {
    return "Iterable";
  }
}
console.log([...new Iterable()].join(), String(new Iterable()));
