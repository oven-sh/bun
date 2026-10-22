const log: string[] = [];

class Gate {
  passes = 0;
  open(): number {
    return ++this.passes;
  }
}

function throwing(this: Gate): number {
  this.passes++;
  throw new RangeError("closed");
}

function throwingAString(): number {
  throw "a string";
}

function guarded(g: Gate): string {
  try {
    return "opened " + g.open();
  } catch (error) {
    return "caught " + (error instanceof Error ? error.constructor.name : typeof error);
  } finally {
    log.push("finally");
  }
}

function partial(g: Gate): string {
  const steps: number[] = [];
  try {
    steps.push(1);
    g.open();
    steps.push(2);
    g.open();
    steps.push(3);
  } catch {
    steps.push(-1);
  }
  return steps.join();
}

function stores(g: Gate): string {
  const record: { a?: number; b?: number } = {};
  let local = 0;
  try {
    record.a = 1;
    local = 1;
    g.open();
    record.b = 2;
    local = 2;
  } catch {}
  return JSON.stringify(record) + " " + local;
}

function inALoop(g: Gate): string {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < 4; i++) {
    try {
      g.open();
      done++;
    } catch {
      failed++;
    }
  }
  return done + " done, " + failed + " failed, " + g.passes + " passes";
}

function unguarded(g: Gate): number {
  return g.open() + g.open();
}

function outer(g: Gate): string {
  try {
    return "sum " + unguarded(g);
  } catch (error) {
    return "caught outside " + (error instanceof Error ? error.constructor.name : typeof error) + " after " + g.passes;
  }
}

function round(label: string): void {
  log.length = 0;
  console.log(label + ": " + guarded(new Gate()) + " | " + partial(new Gate()) + " | " + stores(new Gate()) + " | " + inALoop(new Gate()) + " | " + outer(new Gate()) + " | " + log.join());
}

const original = Gate.prototype.open;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += guarded(new Gate()).length + partial(new Gate()).length + outer(new Gate()).length;
console.log("2000 honest: " + warm);
round("the method");
round("one that throws an error");
round("one that throws a string");
round("put back");

export {};
