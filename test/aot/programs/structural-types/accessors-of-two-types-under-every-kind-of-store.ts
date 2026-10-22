function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

class Box {
  kept = 10;
  get size(): number {
    log.push("get");
    return this.kept;
  }
  set size(value: number | string) {
    log.push("set " + typeof value + " " + String(value));
    this.kept = typeof value === "string" ? value.length : value;
  }
}

function logged(label: string, run: (b: Box) => unknown): void {
  log.length = 0;
  const b = new Box();
  attempt(label, () => [run(b), b.kept]);
  console.log("  " + log.join(", "));
}

logged("a store of a number", b => (b.size = 3));
logged("a store of a string", b => (b.size = "four"));
logged("plus equals", b => (b.size += 1));
logged("minus equals", b => (b.size -= 1));
logged("times equals", b => (b.size *= 2));
logged("power equals", b => (b.size **= 2));
logged("shift equals", b => (b.size <<= 1));
logged("increment after", b => b.size++);
logged("increment before", b => ++b.size);
logged("decrement after", b => b.size--);
logged("or equals, truthy", b => (b.size ||= "unused"));
logged("or equals, falsy", b => {
  b.kept = 0;
  return (b.size ||= "seven letters".slice(0, 7));
});
logged("and equals, truthy", b => (b.size &&= "abc"));
logged("and equals, falsy", b => {
  b.kept = 0;
  return (b.size &&= "abc");
});
logged("nullish equals", b => (b.size ??= "unused"));
logged("a chain of stores", b => {
  const other = new Box();
  const result = (b.size = other.size = "chain");
  return [result, other.kept];
});
logged("its own value stored back", b => (b.size = b.size));
logged("added to itself", b => (b.size += b.size));
logged("a store inside the right side", b => (b.size += b.size = 5));
logged("a store as an argument", b => String((b.size = "ab")).length);
logged("a destructuring store", b => {
  [b.size] = ["abcde"];
  return b.size;
});
logged("a destructuring store from an object", b => {
  ({ n: b.size } = { n: "abcdef" });
  return b.size;
});
logged("a loop variable", b => {
  const seen: number[] = [];
  for (b.size of [1, "ab", 3]) seen.push(b.size);
  return seen;
});
logged("2000 numbers and then a string", b => {
  let sum = 0;
  log.length = 0;
  for (let i = 0; i < 2000; i++) {
    b.size = i;
    sum += b.size;
  }
  log.length = 0;
  b.size = "abc";
  return [sum, b.size];
});
