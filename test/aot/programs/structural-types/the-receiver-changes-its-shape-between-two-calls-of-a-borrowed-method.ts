class Owner {
  first: string = "ann";
}

class Subject {
  count: number = 10;
  label: string = "subject";
  owner: Owner = new Owner();
  action: () => number = () => 7;
  #secret: number = 42;
  readCount(): number {
    return this.count;
  }
  countPlusOne(): number {
    return this.count + 1;
  }
  readLabel(): string {
    return this.label;
  }
  labelLength(): number {
    return this.label.length;
  }
  ownerName(): string {
    return this.owner.first;
  }
  runAction(): number {
    return this.action();
  }
  readSecret(): number {
    return this.#secret;
  }
  storeCount(): number {
    this.count = 99;
    return this.count;
  }
  bump(): number {
    return ++this.count;
  }
  storeLabel(): string {
    this.label = "stored";
    return this.label;
  }
  callsOther(): number {
    return this.readCount() * 2;
  }
  kind(): string {
    return typeof this;
  }
}

function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const s = new Subject();
const read = s.readCount;
const measure = s.labelLength;
const act = s.runAction;

function look(title: string, receiver: object): void {
  show(title + ": count", () => read.call(receiver));
  show(title + ": label length", () => measure.call(receiver));
  show(title + ": action", () => act.call(receiver));
}

const subject = new Subject();
look("at the start", subject);
const loose: { count?: number; label?: string; action?: () => number } = subject;
delete loose.count;
look("count deleted", subject);
subject.count = 5;
look("count set again", subject);
const wide: { label: string | number; action: (() => number) | string } = subject;
wide.label = 12;
look("a number in label", subject);
wide.action = "not a function";
look("a string in action", subject);
Object.defineProperty(subject, "count", { get: () => 77, configurable: true });
look("count is a getter", subject);
Object.setPrototypeOf(subject, null);
look("no prototype", subject);
Object.freeze(subject);
look("frozen", subject);
show("a store to the frozen one", () => s.storeLabel.call(subject));

const literal: { count: number; label?: string; action?: () => number } = { count: 1 };
look("a literal with a count", literal);
literal.label = "added";
look("a label added", literal);
literal.action = () => 9;
look("an action added", literal);
delete literal.label;
look("the label deleted", literal);

let total = 0;
const steady = new Subject();
const steadyLoose: { count?: number } = steady;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) delete steadyLoose.count;
  if (i === 1500) steady.count = 1;
  const n = read.call(steady);
  total += n === undefined ? 1000 : n;
}
show("deleted and set again in the middle of a loop", () => total);
