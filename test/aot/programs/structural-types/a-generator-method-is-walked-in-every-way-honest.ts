const log: string[] = [];

class Shelf {
  books: string[] = ["a", "b", "c"];
  *titles(): IterableIterator<string> {
    log.push("generator started");
    try {
      for (const book of this.books) yield book;
    } finally {
      log.push("generator closed");
    }
  }
}

class Custom implements IterableIterator<string> {
  at = 0;
  [Symbol.iterator](): this {
    log.push("custom iterator asked");
    return this;
  }
  next(): IteratorResult<string, undefined> {
    return ++this.at <= 2 ? { done: false, value: "custom " + this.at } : { done: true, value: undefined };
  }
  return(): IteratorResult<string, undefined> {
    log.push("custom closed");
    return { done: true, value: undefined };
  }
}

function all(s: Shelf): string {
  const seen: string[] = [];
  for (const title of s.titles()) seen.push(title);
  return seen.join();
}

function first(s: Shelf): string {
  for (const title of s.titles()) return title;
  return "none";
}

function spread(s: Shelf): string {
  return [...s.titles()].join();
}

function byHand(s: Shelf): string {
  const it = s.titles();
  const one = it.next();
  const two = it.next();
  return String(one.value) + " " + String(two.value) + " " + two.done;
}

function kind(s: Shelf): string {
  return Object.prototype.toString.call(s.titles());
}

function round(label: string, s: Shelf): void {
  log.length = 0;
  console.log(label + ": " + all(s) + " | " + first(s) + " | " + spread(s) + " | " + byHand(s) + " | " + kind(s) + " [" + log.join(", ") + "]");
}

function* started(): Generator<string, undefined, unknown> {
  yield "skipped";
  yield "second";
  yield "third";
  return undefined;
}

const s = new Shelf();
const other = new Shelf();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += all(s).length + first(s).length + spread(other).length;
console.log("2000 honest: " + warm);
round("the generator method", s);

export {};
