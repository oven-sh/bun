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

function watcher(o: Subject): { bare: () => number; kept: () => number; late: () => number } {
  const method = o.readCount;
  return {
    bare: () => method(),
    kept: () => method.call(o),
    late: () => o.readCount(),
  };
}

const s = new Subject();
const watch = watcher(s);
show("bare", watch.bare);
show("kept", watch.kept);
show("late", watch.late);

s.count = 11;
show("after a store: kept", watch.kept);
show("after a store: late", watch.late);

s.readCount = () => -1;
show("after an own member hides the method: kept", watch.kept);
show("after an own member hides the method: late", watch.late);

const original = Subject.prototype.readCount;
Subject.prototype.readCount = function (): number {
  return this.count * 100;
};
const t = new Subject();
const second = watcher(t);
show("taken off after the prototype changed: kept", second.kept);
show("the first one still has the old function: kept", watch.kept);
Subject.prototype.readCount = original;
show("put back: what was taken off stays: kept", second.kept);
show("put back: late", second.late);

let current: Subject = new Subject();
const method = current.countPlusOne;
const onCurrent = (): number => method.call(current);
show("a captured variable: first object", onCurrent);
current = t;
t.count = 70;
show("a captured variable: second object", onCurrent);
let total = 0;
for (let i = 0; i < 2000; i++) total += onCurrent();
show("2000 calls", () => total);
const stranger: Subject = Object.create(Subject.prototype);
current = stranger;
show("a captured variable: an object without fields", onCurrent);
