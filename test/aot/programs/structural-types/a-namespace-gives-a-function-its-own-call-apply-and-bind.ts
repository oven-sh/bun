function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function adder(this: unknown, a: number, b: number): number {
  return a + b;
}
namespace adder {
  export function call(label: string): string {
    return "own call " + label;
  }
  export function apply(label: string): string {
    return "own apply " + label;
  }
  export function bind(label: string): string {
    return "own bind " + label;
  }
  export function toString(): string {
    return "own toString";
  }
}

function plain(this: unknown, a: number, b: number): number {
  return a * b;
}

class Tool {
  static run(n: number): number {
    return n + 1;
  }
}
namespace Tool {
  export function call(label: string): string {
    return "the call of the class " + label;
  }
}

show("the function runs", () => adder(1, 2));
show("call", () => adder.call("x"));
show("apply", () => adder.apply("y"));
show("bind", () => adder.bind("z"));
show("toString", () => [adder.toString(), String(adder), `${adder}`]);
show("keys", () => Object.keys(adder));
show("the built-in call on it", () => Function.prototype.call.call(adder, undefined, 1, 2));
show("Reflect.apply", () => Reflect.apply(adder, undefined, [3, 4]));
show("a function without a namespace", () => [plain.call(undefined, 2, 3), plain.apply(undefined, [2, 4]), plain.bind(undefined, 2)(5)]);
show("the class", () => [Tool.call("c"), Tool.run(1), Tool.run.call(Tool, 2), Object.keys(Tool)]);

let letters = 0;
let sum = 0;
for (let i = 0; i < 2000; i++) {
  letters += adder.call("x").length;
  sum += plain.call(undefined, i, 1) + adder(i, 1);
}
show("2000 rounds", () => [letters, sum]);
