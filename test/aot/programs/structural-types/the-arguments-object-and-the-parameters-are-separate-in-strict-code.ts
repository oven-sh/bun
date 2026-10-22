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

console.log("strict: " + (function (this: unknown) {
  return this === undefined;
})());

function storeToParameter(a: number, b: string): unknown[] {
  a = 99;
  b = "changed";
  return [a, b, arguments[0], arguments[1], arguments.length];
}

function storeToArguments(a: number, b: string): unknown[] {
  arguments[0] = "text";
  arguments[1] = 5;
  return [typeof a, a, a + 1, typeof b, b, b.toUpperCase(), arguments[0], arguments[1]];
}

function fewer(a: number, b?: number, c: number = 7): unknown[] {
  return [arguments.length, a, b, c, arguments[1], arguments[2], 1 in arguments, 2 in arguments];
}

function storeBeyond(a: number, b?: number): unknown[] {
  arguments[1] = 5;
  return [arguments.length, b, arguments[1], Object.keys(arguments)];
}

function more(a: number): unknown[] {
  return [arguments.length, a, arguments[1], arguments[2], more.length];
}

function withRest(a: number, ...rest: number[]): unknown[] {
  rest[0] = 100;
  return [arguments.length, arguments[1], rest, rest.length];
}

function increments(a: number): unknown[] {
  a++;
  arguments[0]++;
  return [a, arguments[0]];
}

function captured(a: number): unknown[] {
  const read = () => a;
  arguments[0] = 50;
  const first = read();
  a = 60;
  return [first, read(), arguments[0]];
}

function leaked(a: number, b: number): IArguments {
  return arguments;
}

function sumOf(list: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += sumOf(leaked(i, 1)) + Number(storeToParameter(i, "s")[2]) + Number(fewer(i)[0]);
console.log("2000 honest rounds: " + total);

attempt("a store to a parameter", () => storeToParameter(1, "b"));
attempt("a store to arguments", () => storeToArguments(1, "b"));
attempt("fewer arguments", () => [fewer(1), fewer(1, 2), fewer(1, undefined, undefined), fewer(1, 2, 3)]);
attempt("a store beyond what was passed", () => [storeBeyond(1), storeBeyond(1, 2)]);
const loose: (...all: number[]) => unknown[] = more;
attempt("more arguments than parameters", () => [loose(1), loose(1, 2, 3)]);
attempt("a rest parameter", () => [withRest(1), withRest(1, 2, 3)]);
attempt("increments", () => increments(1));
attempt("a captured parameter", () => captured(1));
attempt("leaked", () => {
  const all = leaked(1, 2);
  all[0] = 10;
  return [sumOf(all), Array.from(all), Object.prototype.toString.call(all), Array.isArray(all)];
});
attempt("callee", () => {
  function f(): unknown {
    return arguments.callee;
  }
  return f();
});
attempt("an arrow function sees the outer ones", () => {
  function outer(a: number, b: number): unknown[] {
    const inner = (c: number) => [arguments.length, arguments[0], c];
    return inner(9);
  }
  return outer(1, 2);
});

export {};
