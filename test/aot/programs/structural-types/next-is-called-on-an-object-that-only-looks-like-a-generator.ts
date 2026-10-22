class Pretender extends Iterator<number, string, number> {
  next(): IteratorResult<number, string> {
    return { done: false, value: 100 };
  }
  return(value: string): IteratorResult<number, string> {
    return { done: true, value };
  }
  throw(): IteratorResult<number, string> {
    return { done: false, value: -1 };
  }
  [Symbol.iterator](): this {
    return this;
  }
}
const g: Generator<number, string, number> = new Pretender();
console.log("zzqq " + g.next(0).value);
export {};
