function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Short implements Iterator<number> {
  at = 0;
  limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  next(): IteratorResult<number> {
    if (this.at < this.limit) return { done: false, value: ++this.at };
    return { done: true, value: undefined };
  }
}

class Endless implements Iterator<number> {
  at = 0;
  next(): IteratorResult<number> {
    return { done: false, value: ++this.at };
  }
}

class EndsWithText implements Iterator<number, string> {
  at = 0;
  next(): IteratorResult<number, string> {
    if (this.at < 2) return { done: false, value: ++this.at };
    return { done: true, value: "over" };
  }
}

function* twoThenText(): Generator<number, string, void> {
  yield 1;
  yield 2;
  return "finished";
}

class Row {
  cells: number[] = [];
  last: number = 0;
}

function takeFive(it: Iterator<number>): string {
  const row = new Row();
  let sum = 0;
  let whole = 0;
  for (let i = 0; i < 5; i++) {
    const n: number = it.next().value;
    sum += n;
    whole = (whole + n) | 0;
    row.cells.push(n);
    row.last = n;
  }
  return "sum " + text(sum) + ", whole " + text(whole) + ", last " + text(row.last) + ", cells " + row.cells.map(text).join("; ") + ", json " + JSON.stringify(row);
}

function fixed(it: Iterator<number>): string {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const n: number = it.next().value;
    try {
      out.push(n.toFixed(1));
    } catch (error) {
      out.push(failure(error));
    }
  }
  return out.join();
}

console.log("endless: " + takeFive(new Endless()));
console.log("short: " + takeFive(new Short(3)));
console.log("ends with text: " + takeFive(new EndsWithText()));
console.log("a generator that returns text: " + takeFive(twoThenText()));
console.log("an array's iterator: " + takeFive([1, 2][Symbol.iterator]()));
console.log("endless again: " + takeFive(new Endless()));

console.log("fixed, endless: " + fixed(new Endless()));
console.log("fixed, short: " + fixed(new Short(2)));
console.log("fixed, ends with text: " + fixed(new EndsWithText()));

const forever = new Endless();
let warm = 0;
function one(it: Iterator<number>): number {
  return it.next().value;
}
for (let i = 0; i < 2000; i++) warm += one(forever);
console.log("2000 honest reads: " + warm);
const ending = new Short(1);
console.log("then: " + text(one(ending)) + ", " + text(one(ending)) + ", " + text(one(ending) + 1));
console.log("and honest again: " + text(one(forever)));
