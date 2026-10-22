function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Countdown {
  [Symbol.iterator](): Iterator<number>;
}
class Countdown {
  from: number = 1;
}

interface Feed {
  [Symbol.asyncIterator](): AsyncIterator<number>;
}
class Feed {
  id: number = 2;
}

interface Handle {
  [Symbol.dispose](): void;
}
class Handle {
  id: number = 3;
}

interface Money {
  [Symbol.toPrimitive](hint: string): number;
}
class Money {
  cents: number = 4;
}

function total(numbers: Iterable<number>): number {
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum;
}

function listOf(numbers: Iterable<number>): number[] {
  return [...numbers];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i, 1]) + total(new Set([i])) + listOf([i]).length;
show("2000 honest rounds", () => warm);

const range = new Countdown();
show("for of", () => total(range));
show("spread", () => listOf(range));
show("Array.from takes it for an array-like", () => Array.from(range));
show("new Set", () => new Set(range).size);
show("taken apart", () => {
  const [first] = range;
  return first;
});
show("Math.max", () => Math.max(...range));
show("yield*", () => {
  function* all(): Generator<number> {
    yield* range;
  }
  return [...all()];
});
show("the method itself", () => range[Symbol.iterator]);
show("in", () => Symbol.iterator in range);

const stream = new Feed();
try {
  let sum = 0;
  for await (const n of stream) sum += n;
  show("for await", () => sum);
} catch (error) {
  show("for await", () => {
    throw error;
  });
}

show("using", () => {
  using handle = new Handle();
  return handle.id;
});
show("the stack of disposables", () => {
  const stack = new DisposableStack();
  stack.use(new Handle());
  return "taken";
});

const money = new Money();
show("the method itself", () => money[Symbol.toPrimitive]);
show("called", () => money[Symbol.toPrimitive]("number"));
show("in a template", () => `${money}`);
show("honest again", () => [total([1, 2]), listOf(new Set([3]))]);

export {};
