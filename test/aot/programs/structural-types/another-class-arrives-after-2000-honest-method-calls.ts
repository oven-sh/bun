class Counter {
  count = 0;
  step = 1;
  advance(): number {
    this.count += this.step;
    return this.count;
  }
  get next(): number {
    return this.count + this.step;
  }
}

class Backwards {
  step = 1;
  label = "backwards";
  count = 0;
  advance(): number {
    this.count -= this.step;
    return this.count;
  }
  get next(): number {
    return this.count - this.step;
  }
}

function advance(c: Counter): number {
  return c.advance();
}

function peek(c: Counter): number {
  return c.next;
}

function count(c: Counter): number {
  return c.count;
}

function isCounter(c: Counter): boolean {
  return c instanceof Counter;
}

function drive(c: Counter, times: number): number {
  let last = 0;
  for (let i = 0; i < times; i++) last = c.advance() + c.next + c.count;
  return last;
}

const honest = new Counter();
let sum = 0;
let yes = 0;
for (let i = 0; i < 2000; i++) {
  sum += advance(honest) + peek(honest) + count(honest);
  if (isCounter(honest)) yes++;
}
console.log("2000 honest rounds: " + sum + " " + yes);

const other = new Backwards();
console.log("the other class, advance: " + advance(other));
console.log("the other class, next: " + peek(other));
console.log("the other class, count: " + count(other));
console.log("the other class, instanceof: " + isCounter(other));
console.log("honest again: " + advance(honest) + " " + peek(honest) + " " + count(honest) + " " + isCounter(honest));
console.log("the other class again: " + advance(other) + " " + peek(other) + " " + count(other) + " " + isCounter(other));
console.log("its own member is untouched: " + other.label + " " + JSON.stringify(other));

console.log("a loop over the honest one: " + drive(new Counter(), 2000));
console.log("the same loop over the other: " + drive(new Backwards(), 2000));

const literal: Counter = {
  count: 100,
  step: 5,
  advance() {
    this.count *= 2;
    return this.count;
  },
  next: -1,
};
console.log("a literal: " + advance(literal) + " " + peek(literal) + " " + count(literal) + " " + isCounter(literal));
console.log("a loop over the literal: " + drive(literal, 3));

let current: Counter = new Counter();
const trace: number[] = [];
for (let i = 0; i < 2004; i++) {
  if (i === 2000) current = new Backwards();
  const result = current.advance();
  if (i >= 1998) trace.push(result);
}
console.log("swapped in the middle of a loop: " + trace.join());

export {};
