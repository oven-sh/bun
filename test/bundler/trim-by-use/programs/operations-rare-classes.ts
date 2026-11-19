class Counter {
  static label = "a";
  static count = 0;
  static next(): number {
    return ++Counter.count;
  }
}
const literal = {
  get doubled() {
    return Counter.count * 2;
  },
};
async function later(value: number) {
  await null;
  return value + 1;
}
const unknown: any = Counter.next;
console.log(Counter.label, Counter.next(), unknown.call(Counter), literal.doubled, await later(1));
