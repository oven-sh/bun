// A static field under a symbol lies on the class itself, and a subclass finds it there until it stores its own.
export {};

const kCount = Symbol("count");
class Counter {
  static [kCount] = 0;
  static bump(): number {
    return ++this[kCount];
  }
}
class Below extends Counter {}
for (let round = 0; round < 300; round++) Counter.bump();
console.log(Counter[kCount], Below[kCount], Object.hasOwn(Below, kCount), Object.getOwnPropertySymbols(Counter).length);
Below.bump();
console.log(Counter[kCount], Below[kCount], Object.hasOwn(Below, kCount));
