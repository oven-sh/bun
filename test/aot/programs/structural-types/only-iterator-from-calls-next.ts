const log: string[] = [];

class Countdown {
  left = 3;
  next(): IteratorResult<number, undefined> {
    log.push("next");
    return this.left > 0 ? { done: false, value: this.left-- } : { done: true, value: undefined };
  }
}

console.log(
  Iterator.from(new Countdown())
    .map(n => n * 2)
    .toArray()
    .join() +
    " [" +
    log.length +
    "]",
);

export {};
