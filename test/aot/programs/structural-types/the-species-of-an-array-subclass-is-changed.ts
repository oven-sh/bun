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

class Plain extends Array<number> {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
  mine(): string {
    return "plain";
  }
}

class Other extends Array<number> {
  other = true;
}

class Redirected extends Array<number> {}
Object.defineProperty(Redirected, Symbol.species, { value: Other });

class Nothing extends Array<number> {}
Object.defineProperty(Nothing, Symbol.species, { value: undefined });

class Nulled extends Array<number> {}
Object.defineProperty(Nulled, Symbol.species, { value: null });

let reads = 0;
class Counted extends Array<number> {}
Object.defineProperty(Counted, Symbol.species, {
  get() {
    reads++;
    return Counted;
  },
});

class Bucket {
  length = 0;
  constructor(public asked: number) {}
}

class Odd extends Array<number> {}
Object.defineProperty(Odd, Symbol.species, { value: Bucket });

function fill<T extends number[]>(list: T): T {
  list.push(1, 2, 3);
  return list;
}

function nameOf(numbers: number[]): string {
  return numbers.constructor.name;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(value => value * 2);
}

function tail(numbers: number[]): number[] {
  return numbers.slice(1);
}

function sum(numbers: number[]): number {
  let total = 0;
  for (const value of numbers) total += value;
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(doubled([i, 1])) + sum(tail([i, 1])) + nameOf([i]).length;
console.log("after 2000 plain arrays", warm);

const makers: [string, () => number[]][] = [
  ["species Array", () => fill(new Plain())],
  ["species another subclass", () => fill(new Redirected())],
  ["species undefined", () => fill(new Nothing())],
  ["species null", () => fill(new Nulled())],
  ["species counted", () => fill(new Counted())],
];
for (const [name, make] of makers) {
  attempt(name + ": itself", () => [nameOf(make()), sum(make())]);
  attempt(name + ": map", () => [nameOf(doubled(make())), sum(doubled(make()))]);
  attempt(name + ": slice", () => [nameOf(tail(make())), sum(tail(make()))]);
  attempt(name + ": filter, concat, splice, flat", () => [nameOf(make().filter(() => true)), nameOf(make().concat([1])), nameOf(make().splice(0, 1)), nameOf(make().flat())]);
}
console.log("reads of the counted species", reads);
attempt("a species that makes no array: map", () => {
  const made: unknown = fill(new Odd()).map(value => value * 2);
  return [Array.isArray(made), made];
});
attempt("a species that makes no array: the result used as an array", () => sum(doubled(fill(new Odd()))));
attempt("a species that makes no array: its length", () => doubled(fill(new Odd())).length);
attempt("the constructor member of one instance is replaced", () => {
  const list = fill(new Other());
  Object.defineProperty(list, "constructor", { value: Array });
  return [nameOf(doubled(list)), doubled(list) instanceof Other];
});
attempt("the constructor member of a plain array is replaced", () => {
  const list = [1, 2, 3];
  Object.defineProperty(list, "constructor", { value: Other });
  return [nameOf(doubled(list)), doubled(list) instanceof Other, sum(doubled(list))];
});
attempt("the constructor member is no constructor", () => {
  const list = [1, 2, 3];
  Object.defineProperty(list, "constructor", { value: 5 });
  return doubled(list);
});
attempt("a plain array again", () => [nameOf(doubled([1])), sum(tail([1, 2]))]);
