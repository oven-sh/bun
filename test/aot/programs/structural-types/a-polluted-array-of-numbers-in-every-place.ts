function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

function pollute(numbers: number[]): number[] {
  const wide: (number | string)[] = numbers;
  wide.push("4");
  return numbers;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function made(): number[] {
  return pollute([1, 2, 3]);
}

class Stats {
  label = "stats";
  samples: number[] = [1, 2, 3];
  scale = 0.5;
  total(): number {
    let total = 0;
    for (const sample of this.samples) total += sample;
    return total;
  }
  last(): number {
    return this.samples[this.samples.length - 1] * this.scale;
  }
}

function reader(numbers: number[]): () => number {
  return () => sum(numbers) + numbers[numbers.length - 1];
}

function eitherWay(value: number[] | number): number {
  return typeof value === "number" ? value : sum(value);
}

function generic<T extends number[]>(numbers: T): number {
  return sum(numbers) + numbers[3];
}

let shared: number[] = [1, 2, 3];
function sumShared(): number {
  return sum(shared);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [i, 2, 3, 4];
  warm += sum(honest) + new Stats().total() + new Stats().last() + reader(honest)() + eitherWay(honest) + eitherWay(i) + generic(honest) + sumShared();
}
console.log("after 2000 honest arrays", warm);

attempt("a parameter", () => sum(pollute([1, 2, 3])));
attempt("a local", () => {
  const local: number[] = [1, 2, 3];
  pollute(local);
  let total = 0;
  for (const number of local) total += number;
  return [total, local[3] * 2, typeof local[3]];
});
attempt("a result", () => [sum(made()), made()[3] - 1, made().length]);
attempt("a field", () => {
  const stats = new Stats();
  pollute(stats.samples);
  return [stats.total(), stats.last(), stats.label, stats.scale];
});
attempt("an element", () => {
  const rows: number[][] = [[1], [1, 2, 3]];
  pollute(rows[1]);
  return rows.map(sum);
});
attempt("a map value", () => {
  const byName = new Map<string, number[]>([["a", [1, 2, 3]]]);
  pollute(byName.get("a") ?? []);
  return sum(byName.get("a") ?? []);
});
attempt("a captured variable", () => {
  const numbers = [1, 2, 3];
  const read = reader(numbers);
  const before = read();
  pollute(numbers);
  return [before, read()];
});
attempt("a module variable", () => {
  const before = sumShared();
  pollute(shared);
  const after = sumShared();
  shared = [1, 2, 3];
  return [before, after, sumShared()];
});
attempt("a member of a union", () => [eitherWay(made()), eitherWay(5)]);
attempt("a generic", () => generic(made()));
attempt("a member of a literal", () => {
  const holder = { before: 1, numbers: [1, 2, 3], after: 2 };
  pollute(holder.numbers);
  return [holder.before, sum(holder.numbers), holder.after];
});
attempt("a rest parameter", () => {
  const add = (...numbers: number[]) => sum(numbers);
  return add(...made());
});
attempt("after 3000 honest pushes", () => {
  const numbers: number[] = [];
  for (let i = 0; i < 3000; i++) numbers.push(1);
  pollute(numbers);
  numbers.push(1);
  return [sum(numbers), numbers.length, typeof numbers[3000]];
});
attempt("after 3000 honest pushes of doubles", () => {
  const numbers: number[] = [];
  for (let i = 0; i < 3000; i++) numbers.push(0.5);
  pollute(numbers);
  return [sum(numbers), typeof numbers[3000], numbers[2999]];
});
attempt("honest again", () => [sum([1, 2, 3]), new Stats().total(), generic([1, 2, 3, 4])]);
