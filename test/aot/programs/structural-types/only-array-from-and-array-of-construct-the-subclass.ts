const log: string[] = [];

class Stack extends Array<number> {
  constructor(...items: number[]) {
    super(...items);
    log.push("constructed with " + items.length);
  }
}

const from = Stack.from([1, 2, 3]);
const of = Stack.of(7, 8);
console.log(from.constructor.name + " " + from.join() + " " + of.constructor.name + " " + of.join() + " [" + log.join(", ") + "]");

export {};
