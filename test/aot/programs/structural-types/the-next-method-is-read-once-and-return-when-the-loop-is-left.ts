const log: string[] = [];

class Counter implements IterableIterator<number> {
  at = 0;
  limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  [Symbol.iterator](): this {
    log.push("iterator");
    return this;
  }
  next(): IteratorResult<number, undefined> {
    this.at++;
    return this.at <= this.limit ? { done: false, value: this.at } : { done: true, value: undefined };
  }
  return?(): IteratorResult<number, undefined>;
}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

function walk(c: Counter, change: (c: Counter, n: number) => void): string {
  const seen: number[] = [];
  for (const n of c) {
    seen.push(n);
    change(c, n);
  }
  return seen.join();
}

function walkAndLeave(c: Counter, change: (c: Counter, n: number) => void): string {
  const seen: number[] = [];
  for (const n of c) {
    seen.push(n);
    change(c, n);
    if (n === 3) break;
  }
  return seen.join();
}

const hundreds = function (this: Counter): IteratorResult<number, undefined> {
  this.at++;
  return this.at <= this.limit ? { done: false, value: this.at * 100 } : { done: true, value: undefined };
};

const closing = (): IteratorResult<number, undefined> => {
  log.push("return ran");
  return { done: true, value: undefined };
};

line("nothing changes", walk(new Counter(5), () => {}));
line(
  "an own next appears in the middle",
  walk(new Counter(5), (c, n) => {
    if (n === 2) c.next = hundreds;
  }),
);

const original = Counter.prototype.next;
line(
  "the prototype's next is replaced in the middle",
  walk(new Counter(5), (c, n) => {
    if (n === 2) Counter.prototype.next = hundreds;
  }),
);
line("the next loop uses it from the start", walk(new Counter(3), () => {}));
Counter.prototype.next = original;
line("put back", walk(new Counter(3), () => {}));

line("left early, no return method", walkAndLeave(new Counter(5), () => {}));
line(
  "a return method appears before the loop is left",
  walkAndLeave(new Counter(5), (c, n) => {
    if (n === 2) c.return = closing;
  }),
);
Counter.prototype.return = closing;
line("on the prototype", walkAndLeave(new Counter(5), () => {}));
line("a loop that runs to its end does not call it", walk(new Counter(2), () => {}));
line(
  "covered by undefined before the loop is left",
  walkAndLeave(new Counter(5), (c, n) => {
    if (n === 2) c.return = undefined;
  }),
);
delete Counter.prototype.return;

function firstTwo(c: Counter): string {
  const [a, b] = c;
  return a + " " + b;
}

line("a pattern, no return method", firstTwo(new Counter(5)));
Counter.prototype.return = closing;
line("a pattern closes what it did not finish", firstTwo(new Counter(5)));
line("a pattern that finishes it", firstTwo(new Counter(1)));
line("spread", [...new Counter(3)].join());
delete Counter.prototype.return;

let warm = 0;
for (let i = 0; i < 2000; i++) warm += walk(new Counter(3), () => {}).length;
log.length = 0;
line("2000 honest", warm);
line(
  "then an own next in the middle",
  walk(new Counter(5), (c, n) => {
    if (n === 2) c.next = hundreds;
  }),
);

export {};
