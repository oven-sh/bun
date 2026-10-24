function sum(list: number[]): number {
  let total = 0;
  for (const n of list) total += n;
  return total;
}

function spread(list: number[]): string {
  return [...list].join();
}

function firstTwo(list: number[]): string {
  const [a, b] = list;
  return a + " " + b;
}

function rest(list: number[]): string {
  const [, ...others] = list;
  return others.join();
}

function largest(list: number[]): number {
  return Math.max(...list);
}

function byIndex(list: number[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function all(list: number[]): string {
  return [sum(list), spread(list), firstTwo(list), rest(list), largest(list), byIndex(list), Array.from(list).join(), new Set(list).size, list.join(), list.map(n => n).join(), [0].concat(list).join(), Object.keys(list).join()].join(" | ");
}

function* countdown(): Generator<number, undefined, unknown> {
  yield 30;
  yield 20;
  yield 10;
  return undefined;
}

const honest = [1, 2, 3];
const changed = [1, 2, 3];
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(honest) + sum(changed) + largest(changed) + spread(changed).length + firstTwo(changed).length;
console.log("2000 honest: " + warm);
console.log("before: " + all(changed));

changed[Symbol.iterator] = countdown;
console.log("an own iterator method: " + all(changed));
console.log("the honest one: " + all(honest));
console.log("own: " + Object.getOwnPropertySymbols(changed).length + ", is an array: " + Array.isArray(changed));

changed[Symbol.iterator] = honest.values.bind(honest);
honest.push(4);
console.log("the values of another array: " + all(changed));

changed[Symbol.iterator] = changed.values;
console.log("its own values method as an own member: " + all(changed));

Reflect.deleteProperty(changed, Symbol.iterator);
console.log("removed: " + all(changed));

class Evens extends Array<number> {
  *[Symbol.iterator](): Generator<number, undefined, unknown> {
    for (let i = 0; i < this.length; i += 2) yield this[i];
    return undefined;
  }
}

const evens = new Evens();
evens.push(1, 2, 3, 4, 5);
console.log("a subclass with its own iterator: " + all(evens));
console.log("what map makes of it: " + all(evens.map(n => n * 10)));

const nested: number[][] = [[1, 2], [3, 4]];
nested[1][Symbol.iterator] = countdown;
let total = 0;
for (const row of nested) for (const n of row) total += n;
console.log("one row of a grid: " + total + " | " + nested.flat().join() + " | " + nested.map(([first]) => first).join());

const tuple: [number, number] = [1, 2];
tuple[Symbol.iterator] = countdown;
const [x, y] = tuple;
console.log("a tuple: " + x + " " + y + " | " + tuple[0] + " " + tuple[1]);

export {};
