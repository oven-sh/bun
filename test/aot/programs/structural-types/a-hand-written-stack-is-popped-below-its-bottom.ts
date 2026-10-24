function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Stack<T> {
  private items: T[] = [];
  private top = 0;
  push(item: T): void {
    this.items[this.top++] = item;
  }
  pop(): T {
    return this.items[--this.top];
  }
  peek(): T {
    return this.items[this.top - 1];
  }
  get size(): number {
    return this.top;
  }
  state(): string {
    return "top " + this.top + ", length " + this.items.length + ", keys " + Object.keys(this.items).join();
  }
}

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

function addTwo(stack: Stack<number>): number {
  return stack.pop() + stack.pop();
}

function glueTwo(stack: Stack<string>): string {
  return stack.pop().toUpperCase() + stack.pop().toUpperCase();
}

let total = 0;
const warmNumbers = new Stack<number>();
const warmStrings = new Stack<string>();
for (let i = 0; i < 2000; i++) {
  warmNumbers.push(i);
  warmNumbers.push(0.5);
  warmStrings.push("a");
  warmStrings.push("b");
  total += addTwo(warmNumbers) + glueTwo(warmStrings).length;
}
console.log("2000 honest rounds: " + total + ", " + warmNumbers.state());

const numbers = new Stack<number>();
attempt("peek at an empty stack of numbers", () => [typeof numbers.peek(), numbers.peek() + 1]);
attempt("pop an empty stack of numbers", () => [typeof numbers.pop(), numbers.size, numbers.state()]);
attempt("push after that: the item lands at minus one", () => {
  numbers.push(7);
  return [numbers.size, numbers.state(), typeof numbers.peek()];
});
attempt("pop again: it comes back", () => [numbers.pop(), numbers.size, numbers.state()]);
attempt("two pops are added", () => {
  const stack = new Stack<number>();
  stack.push(1);
  return [addTwo(stack), stack.state()];
});

const strings = new Stack<string>();
attempt("peek at an empty stack of strings", () => [typeof strings.peek(), strings.peek() + "!"]);
attempt("a method of what is popped off an empty stack", () => strings.pop().length);
attempt("two pops are glued", () => {
  const stack = new Stack<string>();
  stack.push("a");
  return glueTwo(stack);
});

const points = new Stack<Point>();
attempt("a member of what is popped off an empty stack", () => points.pop().x);
const functions = new Stack<() => number>();
attempt("what is popped off an empty stack is called", () => functions.pop()());

attempt("what was popped is still in the list", () => {
  const stack = new Stack<number>();
  stack.push(1);
  stack.push(2);
  stack.pop();
  return [stack.size, stack.state(), stack.peek()];
});
attempt("honest again", () => {
  warmNumbers.push(3);
  warmNumbers.push(4);
  return [addTwo(warmNumbers), warmNumbers.state()];
});

export {};
