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

interface Counter {
  (): number;
  count: number;
  read(): number;
  bump(): number;
  again(): number;
}

function make(): Counter {
  return Object.assign(
    function (): number {
      return 1;
    },
    {
      count: 10,
      read(this: { count: number }): number {
        return this.count;
      },
      bump(this: { count: number }): number {
        return ++this.count;
      },
      again(this: () => number): number {
        return this() + 1;
      },
    },
  );
}

function tally(): number {
  return 2;
}
tally.count = 20;
tally.read = function (this: { count: number }): number {
  return this.count;
};

const counter = make();
show("read: this is the function", () => counter.read());
show("bump", () => counter.bump());
show("count", () => counter.count);
show("again: this is called", () => counter.again());
show("read on another function", () => counter.read.call(tally));
show("read on a literal", () => counter.read.call({ count: 30 }));
show("again on another function", () => counter.again.call(tally));
show("again on an arrow", () => counter.again.call(() => 40));
show("a declared function's member", () => tally.read());
show("that member on the counter", () => tally.read.call(counter));
const moved = { count: 50, read: counter.read, bump: counter.bump };
show("moved to a literal: read", () => moved.read());
show("moved to a literal: bump", () => moved.bump() + " " + counter.count);

class Tool {
  static uses: number = 0;
  static use(): number {
    return ++this.uses;
  }
}
const asObject: { uses: number; use(): number } = { uses: 100, use: Tool.use };
show("a static method moved to a literal", () => asObject.use() + " " + Tool.uses);
show("honest static", () => Tool.use() + " " + asObject.uses);
show("length and name of this", () =>
  Object.assign(
    function named(a: number, b: number): number {
      return a + b;
    },
    {
      about(this: { name: string; length: number }): string {
        return this.name + "/" + this.length;
      },
    },
  ).about(),
);
