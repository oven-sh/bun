class Pretender extends Iterator<number, undefined, unknown> {
  at = 0;
  next(): IteratorResult<number, undefined> {
    return ++this.at > 2 ? { done: true, value: undefined } : { done: false, value: this.at * 100 };
  }
  [Symbol.iterator](): this {
    return this;
  }
}
function firstOf(walk: ArrayIterator<number>): string {
  return "zzqq " + walk.next().value;
}
function sum(walk: ArrayIterator<number>): number {
  let total = 0;
  for (const n of walk) total += n;
  return total;
}
console.log(firstOf([1, 2].values()));
console.log(firstOf(new Pretender()));
console.log("zzqq " + sum([1, 2].values()) + " " + sum(new Pretender()));
const asSet: SetIterator<number> = new Pretender();
const asMap: MapIterator<number> = new Pretender();
console.log("zzqq " + asSet.next().value + " " + asMap.next().value + " " + asSet.toArray().join() + " " + asMap.map(n => n + 1).toArray().join());
export {};
