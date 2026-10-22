class Odd extends Iterator<number, undefined, unknown> {
  at = 0;
  next(): IteratorResult<number, undefined> {
    return ++this.at > 2 ? { done: true, value: undefined } : { done: false, value: this.at };
  }
  map<U>(f: (value: number, index: number) => U): IteratorObject<U, undefined, unknown> {
    console.log("zzqq the map of Odd");
    return super.map(f);
  }
  toArray(): number[] {
    console.log("zzqq the toArray of Odd");
    return super.toArray();
  }
}
function doubled(walk: IteratorObject<number, undefined, unknown>): string {
  return walk.map(n => n * 2).toArray().join();
}
function listed(walk: IteratorObject<number, undefined, unknown>): string {
  return walk.toArray().join();
}
console.log("zzqq " + doubled([1, 2].values()) + " " + listed([1, 2].values()));
console.log("zzqq " + doubled(new Odd()) + " " + listed(new Odd()));
export {};
