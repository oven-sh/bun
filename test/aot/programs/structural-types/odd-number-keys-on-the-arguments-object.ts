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

function read(key: number, a: number, b: number): unknown {
  return arguments[key];
}

function kindOf(key: number, a?: number, b?: string): string {
  return typeof arguments[key];
}

function write(key: number, a: number, b: number): string {
  arguments[key] = 77;
  return "length " + arguments.length + ", keys " + Object.keys(arguments).join() + ", key " + show(key) + ", a " + show(a) + ", b " + show(b) + ", read back " + show(arguments[key]);
}

function sumAll(...ignored: number[]): number {
  let sum = 0;
  for (let i = 0; i < arguments.length; i++) sum += arguments[i];
  return sum;
}

function sumOneTooFar(a: number, b: number): number {
  let sum = 0;
  for (let i = 0; i <= arguments.length; i++) sum += arguments[i];
  return sum;
}

function typedLocal(key: number, a: number): number {
  const value: number = arguments[key];
  return value + 1;
}

function typedText(key: number, a: string): number {
  const value: string = arguments[key];
  return value.length;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += sumAll(i, 1, 2) + typedLocal(1, i) + typedText(1, "ab") + kindOf(1, i).length;
console.log("2000 honest rounds: " + total);

const keys = [0, 1, 2, 3, 99, -1, 0.5, -0, NaN, Infinity, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53];
for (const key of keys) {
  attempt("read " + show(key), () => read(key, 10, 20));
  attempt("kind " + show(key), () => [kindOf(key), kindOf(key, 1), kindOf(key, 1, "s"), kindOf(key, undefined, undefined)]);
  attempt("write " + show(key), () => write(key, 10, 20));
  attempt("into a local typed as a number " + show(key), () => typedLocal(key, 5));
  attempt("into a local typed as a string " + show(key), () => typedText(key, "abc"));
}

attempt("summed", () => [sumAll(), sumAll(1), sumAll(1, 2, 3), sumAll(0.5, 0.25)]);
attempt("summed one too far", () => sumOneTooFar(1, 2));
attempt("the length is stored to", () => {
  function cut(a: number, b: number, c: number): unknown[] {
    arguments.length = 1;
    return [arguments.length, arguments[2], Array.from(arguments), a + b + c];
  }
  return cut(1, 2, 3);
});
attempt("the length is made larger", () => {
  function grow(a: number): unknown[] {
    arguments.length = 3;
    return [arguments.length, Array.from(arguments), [...arguments], 2 in arguments];
  }
  return grow(1);
});
attempt("an element is deleted", () => {
  function drop(a: number, b: number): unknown[] {
    delete arguments[0];
    return [arguments.length, 0 in arguments, arguments[0], a, Array.from(arguments)];
  }
  return drop(1, 2);
});

export {};
