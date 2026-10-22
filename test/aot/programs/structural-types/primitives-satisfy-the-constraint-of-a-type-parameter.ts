function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function lengthOf<T extends { length: number }>(x: T): number {
  return x.length;
}

function longer<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

function textOf<T extends { toString(): string }>(x: T): string {
  return x.toString();
}

function valueOf<T extends { valueOf(): number }>(x: T): number {
  return x.valueOf() + 1;
}

function anything<T extends {}>(x: T): string {
  return typeof x;
}

function fixed<T extends { toFixed(digits: number): string }>(x: T): string {
  return x.toFixed(1);
}

function at<T extends { at(index: number): unknown }>(x: T): unknown {
  return x.at(-1);
}

function sliced<T extends { slice(start: number): T }>(x: T): T {
  return x.slice(1);
}

function kept<T extends { length: number }>(x: T): { held: T; size: number } {
  return { held: x, size: x.length };
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += lengthOf([i]) + longer([i], [i, 1]).length + textOf({ toString: () => "t" }).length + valueOf({ valueOf: () => i }) + fixed({ toFixed: () => "f" }).length;
console.log("2000 honest rounds with objects", warm);

attempt("length of a string", () => lengthOf("abc"));
attempt("length of an empty string", () => lengthOf(""));
attempt("length of an array", () => lengthOf([1, 2]));
attempt("length of a function", () => lengthOf((a: number, b: number) => a + b));
attempt("length of a class", () => lengthOf(class { constructor(a: number) {} }));
attempt("length of a typed array", () => lengthOf(new Uint8Array(3)));
attempt("length of a String object", () => lengthOf(new String("abcd")));
attempt("length of a literal", () => lengthOf({ length: -1 }));
attempt("length of a getter", () => lengthOf({ get length() { log.push("get-length"); return 7; } }));
attempt("length of arguments", () => (function (a: number, b: number) { return lengthOf(arguments); })(1, 2));
attempt("longer of two strings", () => longer("ab", "abc"));
attempt("longer of two arrays", () => longer([1, 2, 3], [4]));
attempt("longer of a string and an array", () => longer<string | number[]>("ab", [1, 2, 3]));
attempt("text of a number", () => textOf(5));
attempt("text of negative zero", () => textOf(-0));
attempt("text of a string", () => textOf("s"));
attempt("text of a boolean", () => textOf(true));
attempt("text of a bigint", () => textOf(5n));
attempt("text of a symbol", () => textOf(Symbol("s")));
attempt("text of an array", () => textOf([1, [2, 3]]));
attempt("text of a function", () => textOf(Math.max).length > 0);
attempt("text of a literal", () => textOf({}));
attempt("value of a number", () => valueOf(5));
attempt("value of a Number object", () => valueOf(new Number(5)));
attempt("value of a date", () => valueOf(new Date(5)));
attempt("anything", () => [anything(1), anything("s"), anything(true), anything(1n), anything(Symbol()), anything([]), anything(() => {}), anything({})]);
attempt("fixed of a number", () => fixed(1.25));
attempt("fixed of a Number object", () => fixed(new Number(2)));
attempt("at of a string and an array", () => [at("abc"), at([1, 2]), at(new Uint8Array([7, 8]))]);
attempt("sliced", () => [sliced<string>("abc"), sliced([1, 2, 3])]);
attempt("kept in a member", () => {
  const a = kept("abc");
  const b = kept([1, 2]);
  const c = kept((x: number) => x);
  return [a.held + "!", a.size, b.held.length, b.size, c.held(5), c.size];
});
attempt("kept in one array", () => {
  const all: { length: number }[] = ["abc", [1, 2], (x: number) => x, new Uint8Array(4), { length: 5 }, new String("abcdef")];
  return all.map(lengthOf);
});
attempt("one site, many kinds, many times", () => {
  const all: { length: number }[] = ["abc", [1, 2], (x: number) => x, new Uint8Array(4), { length: 5 }];
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += lengthOf(all[i % all.length]);
  return sum;
});
