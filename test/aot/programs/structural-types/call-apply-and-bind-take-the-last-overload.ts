function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function size(s: string): number {
  return s.length;
}

function plusOne(n: number): number {
  return n + 1;
}

function twice(x: number): number;
function twice(x: string | number): string;
function twice(x: string | number): string | number {
  return typeof x === "number" ? x * 2 : x + x;
}

function first(list: number[]): number;
function first(list: string[]): string;
function first(list: (number | string)[]): { x: number };
function first(list: (number | string)[]): unknown {
  return list[0];
}

class Reader {
  base = 10;
  read(key: number): number;
  read(key: number | string): string;
  read(key: number | string): number | string {
    return typeof key === "number" ? key + this.base : key + this.base;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += twice(i) + size(twice("a")) + first([i]) + new Reader().read(i);
console.log("2000 honest rounds: " + warm);

attempt("called directly", () => [twice(2) + 1, size(twice("a")), plusOne(first([1])), size(first(["ab"]))]);
attempt("call", () => {
  const result = twice.call(undefined, 2);
  return [result, typeof result, result + "!", result.length];
});
attempt("call, a method of texts", () => twice.call(undefined, 2).toUpperCase());
attempt("call, a parameter", () => size(twice.call(undefined, 2)));
attempt("apply", () => {
  const result = twice.apply(undefined, [2]);
  return [result, typeof result, size(result)];
});
attempt("bind", () => {
  const bound = twice.bind(undefined);
  const withOperand = twice.bind(undefined, 2);
  return [bound(2), typeof bound(2), plusOne(bound(2)), withOperand(), size(withOperand()), size(bound("a"))];
});
attempt("Reflect.apply", () => {
  const result = Reflect.apply(twice, undefined, [2]);
  return [result, typeof result, size(result)];
});
attempt("as a callback", () => {
  const texts: string[] = [1, 2].map(twice);
  return [texts, texts.map(size)];
});
attempt("as a function type", () => {
  const f: (x: number) => string = twice;
  return [f(2), typeof f(2), size(f(2))];
});
attempt("ReturnType and Parameters", () => {
  const result: ReturnType<typeof twice> = twice.call(undefined, 3);
  const operands: Parameters<typeof twice> = [3];
  return [result, size(twice(...operands))];
});
attempt("an object is promised", () => {
  const p = first.call(undefined, [1, 2]);
  return [typeof p, p.x, p.x + 1];
});
attempt("an object is promised and a text comes", () => {
  const p = first.apply(undefined, [["ab"]]);
  return [typeof p, p.x, Object.keys(p).join()];
});
attempt("an object is promised and nothing comes", () => first.call(undefined, []).x);
attempt("a method", () => {
  const reader = new Reader();
  const called = reader.read.call(reader, 1);
  const bound = reader.read.bind(reader);
  return [called, typeof called, size(called), bound(1), plusOne(bound(1)), size(bound("a"))];
});
attempt("a method on another receiver", () => new Reader().read.call({ base: "other" }, 1));

console.log("honest again: " + [twice(2), twice("a"), first([1]), new Reader().read(1)].join(" "));

export {};
