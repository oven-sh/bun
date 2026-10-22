console.log("strict: " + (function (this: unknown) {
  return this === undefined;
})());

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
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

function plusOne(a: number): unknown[] {
  const before = a + 1;
  arguments[0] = "text";
  return [before, typeof a, a, a + 1];
}

function times(a: number, b: number): unknown[] {
  arguments[0] = "6";
  arguments[1] = null;
  return [typeof a, typeof b, a * 2, b * 2, a + b];
}

function fixed(a: number): string {
  arguments[0] = "text";
  return a.toFixed(1);
}

function shout(name: string): string {
  arguments[0] = 5;
  return name.toUpperCase();
}

function width(name: string): unknown[] {
  arguments[0] = 5;
  return [typeof name, name.length, name + "!"];
}

function run(f: () => number): number {
  arguments[0] = 5;
  return f();
}

function member(p: { x: number }): number {
  arguments[0] = undefined;
  return p.x;
}

function theOtherWay(a: number): unknown[] {
  a = 99;
  return [arguments[0], arguments.length];
}

function notPassed(a?: number): unknown[] {
  arguments[0] = 5;
  return [a, arguments[0], arguments.length];
}

function inALoop(a: number): number {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    sum += a;
    if (i === 2) arguments[0] = 0.5;
  }
  return sum;
}

function throughAHelper(a: number): unknown[] {
  spoil(arguments);
  return [typeof a, a, a + 1];
}

function spoil(all: IArguments): void {
  all[0] = "spoiled";
}

function withADefault(a: number, b: number = 2): unknown[] {
  arguments[0] = "text";
  return [typeof a, a, b];
}

function honest(a: number): number {
  arguments[0] = a + 1;
  return a * 2;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += honest(i) + inALoop(1);
console.log("2000 honest rounds: " + total);

attempt("a number parameter + 1", () => plusOne(1));
attempt("two number parameters", () => times(1, 2));
attempt("a method of a number parameter", () => fixed(1));
attempt("a method of a string parameter", () => shout("a"));
attempt("a string parameter", () => width("a"));
attempt("a function parameter is called", () => run(() => 1));
attempt("a member of an object parameter", () => member({ x: 1 }));
attempt("the other way", () => theOtherWay(1));
attempt("not passed: no link", () => [notPassed(), notPassed(1)]);
attempt("in a loop", () => inALoop(1));
attempt("through a helper", () => throughAHelper(1));
attempt("a default value cuts the link", () => withADefault(1));
attempt("honest again", () => honest(3));
