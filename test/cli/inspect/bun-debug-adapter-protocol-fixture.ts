// The program behind bun-debug-adapter-protocol-maps.json. The comments name the lines the test asks about.
const os = require("node:os"); // first statement

function label(value: number): string {
  return (
    "value " + value // after return (
  );
}

export function describe(values: number[]): string[] {
  const labels: string[] = [];
  const add = (value: number) => {
    labels.push(label(value));
  };
  add(0); // after the arrow function
  for (const value of values) {
    if (value < 0) {
      continue; // continue
    }
    add(value);
  }

  // a comment
  return labels;
} // describe ends

enum Mode {
  Idle,
  Busy,
} // enum ends

class Counter {
  constructor(
    private readonly step: number, // first parameter property
    public count: number, // second parameter property
  ) {
    this.reset(); // after the parameter properties
  }

  increment(): number {
    [1, 2].forEach(n => {
      this.count += n * this.step;
    }); // callback ends
    return this.count; // after the callback
  } // increment ends

  reset(): void {
    this.count = 0;
  }
}

function each(values: number[], callback: (value: number) => void, step = 1): void {
  for (let i = 0; i < values.length; i += step) {
    callback(values[i]);
  }
}

const counter = new Counter(2, 0);
counter.increment();
each(
  [1, 2], // first argument
  value => {
    counter.count += value;
  }, // callback before an argument
  1, // argument after the callback
);
each(
  [3],
  () => undefined, // callback without braces
  2, // argument after the callback without braces
);
each(
  [4], // another first argument
  value => {
    counter.count -= value;
  }, // callback before the parenthesis
); // parenthesis after the callback
console.log(describe([1, -1, 2]), Mode.Busy, counter.count, os.EOL.length);
