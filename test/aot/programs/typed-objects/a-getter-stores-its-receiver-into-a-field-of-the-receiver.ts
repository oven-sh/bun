// A getter of a literal stores `this` into `this.self`. It is read off the literal in a loop, and by Reflect.get() with other receivers: a record whose type says that `self` is a number, undefined, and a number.
interface Counter {
  mark?: number;
  self?: number;
  list?: Int16Array;
}
const list: unknown[] = [1, 2];
const tagged = { self: list };
const counter: Counter = {};
const holder = {
  get list() {
    (this as any).self = this as any;
    return list;
  },
  mark: 1 as any,
};
console.log(counter, tagged);
console.log(holder);

let total = 0;
for (let round = 0; round < 1000; round++) total += holder.list.length;
console.log(total, (holder as any).self === holder, Object.keys(holder));

console.log(Reflect.get(holder, "list", counter) === list, (counter as any).self === counter, Object.keys(counter));
for (const receiver of [undefined, 5]) {
  try {
    console.log(Reflect.get(holder, "list", receiver));
  } catch (error) {
    console.log((error as Error).name);
  }
}
console.log(tagged.self === list);
