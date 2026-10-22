class Counter {
  static step = 2;
  static count = 0;
  static next(): number {
    this.count += this.step;
    return this.count;
  }
  static twice(): number {
    return Counter.next() + this.next();
  }
}

function ask(): number {
  return Counter.next();
}

function askThrough(c: typeof Counter): number {
  return c.next();
}

function minus(this: typeof Counter): number {
  return -this.step;
}

const five = (): number => 5;

function patch(target: { next(): number }, replacement: () => number): void {
  target.next = replacement;
}

const original = Counter.next;

function report(label: string): void {
  console.log(label + ": " + Counter.next() + " " + ask() + " " + askThrough(Counter) + " " + Counter.twice() + " count " + Counter.count + " " + (Counter.next === original));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += Counter.next() + ask() + askThrough(Counter);
console.log("2000 honest rounds: " + sum);
report("before");
patch(Counter, minus);
report("replaced by a function");
patch(Counter, five);
report("replaced by an arrow");
patch(Counter, original);
report("put back");

export {};
