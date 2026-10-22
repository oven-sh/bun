const log: string[] = [];

class Counting extends Set<number> {
  add(value: number): this {
    log.push("add " + value);
    return super.add(value * 10);
  }
}

console.log([...new Counting([1, 2])].join() + " [" + log.join(", ") + "]");

export {};
