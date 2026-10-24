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

const log: string[] = [];

class Squares implements ArrayLike<number> {
  readonly [index: number]: number;
  constructor(public readonly length: number) {
    for (let i = 0; i < length; i++) {
      Object.defineProperty(this, i, {
        get() {
          log.push("get " + i);
          return i * i;
        },
        enumerable: true,
      });
    }
  }
}

class Sparse implements ArrayLike<number> {
  readonly [index: number]: number;
  readonly 0 = 10;
  readonly 2 = 30;
  readonly length = 4;
}

class Counting implements ArrayLike<number> {
  readonly [index: number]: number;
  readonly 0 = 1;
  readonly 1 = 2;
  reads = 0;
  get length(): number {
    this.reads++;
    return 2;
  }
}

function lazy(length: number): ArrayLike<number> {
  return new Proxy<ArrayLike<number>>({ length }, {
    get(target, key) {
      if (key === "length") return target.length;
      log.push("trap " + String(key));
      return typeof key === "string" ? Number(key) + 0.5 : undefined;
    },
    has(target, key) {
      log.push("has " + String(key));
      return key in target;
    },
  });
}

function sum(list: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function inspect(list: ArrayLike<number>): string[] {
  const lines: string[] = [];
  for (let i = 0; i < list.length; i++) lines.push(i + " " + (i in list ? "present" : "absent") + " " + typeof list[i] + " " + list[i]);
  return lines;
}

function last(list: ArrayLike<number>): number {
  return list[list.length - 1];
}

function toArray(list: ArrayLike<number>): number[] {
  return Array.from(list);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum([i, 1]) + inspect([i]).length + last([i, 2]) + toArray([i]).length;
console.log("after 2000 arrays", warm);

const makers: [string, () => ArrayLike<number>][] = [
  ["an array", () => [1, 2, 3]],
  ["squares behind getters", () => new Squares(3)],
  ["a sparse class", () => new Sparse()],
  ["a counted length", () => new Counting()],
  ["a proxy", () => lazy(2)],
  ["bytes", () => new Uint8Array([250, 251])],
  ["a literal", () => ({ 0: 5, 1: 6, length: 2 })],
];
for (const [name, make] of makers) {
  log.length = 0;
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": last", () => last(make()));
  attempt(name + ": Array.from", () => toArray(make()));
  attempt(name + ": map.call", () => Array.prototype.map.call(make(), value => typeof value));
  attempt(name + ": isArray", () => Array.isArray(make()));
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": into a Float64Array", () => Array.from(new Float64Array(make())));
  console.log(name + ": log", log.length, log.slice(0, 6).join("; "));
}
attempt("how often the length is read", () => {
  const counting = new Counting();
  const total = sum(counting);
  return [total, counting.reads];
});
attempt("an array again", () => [sum([1, 2, 3]), last([4])]);
