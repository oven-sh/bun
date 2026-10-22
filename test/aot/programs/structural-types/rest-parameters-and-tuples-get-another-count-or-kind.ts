function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sum(...numbers: number[]): number {
  let total = 0;
  for (const n of numbers) total += n;
  return total;
}
function pairText(...pair: [number, string]): string {
  const [n, s] = pair;
  return pair.length + " " + typeof n + " " + typeof s + " " + (n + 1) + " " + s.length;
}
function two(n: number, s: string): string {
  return typeof n + " " + typeof s + " " + (n + 1) + " " + s.length;
}
function tail(first: string, ...others: string[]): string {
  return first + " " + others.length + " " + others.map(o => typeof o + ":" + o.length).join();
}
function optionalTuple(...args: [number, string?]): string {
  return args.length + " " + typeof args[1];
}

const sumTwo: (a: number, b: number) => number = sum;
const sumOne: (a: number) => number = sum;
const tailShort: (first: string) => string = tail;

show("honest sum", () => sum(1, 2, 3));
show("sum of none", () => sum());
show("sum as two", () => sumTwo(1, 2));
show("map sum: index and array arrive", () => [1, 2].map(sumOne).map(v => typeof v + " " + v));
show("reduce sum: index and array arrive", () => {
  const result = [1, 2, 3].reduce(sumTwo, 0);
  return typeof result + " " + result;
});
show("honest tail", () => tail("a", "bc", "def"));
show("map tail: index and array arrive", () => ["a", "b"].map(tailShort));
show("replace tail", () => "abc".replace("b", tailShort));

const pair: [number, string] = [1, "one"];
show("a tuple is spread", () => pairText(...pair));
show("a tuple is spread into two parameters", () => two(...pair));
pair.reverse();
show("reversed, spread", () => pairText(...pair));
show("reversed, spread into two parameters", () => two(...pair));
pair.reverse();
pair.pop();
show("after pop, spread", () => pairText(...pair));
show("after pop, spread into two parameters", () => two(...pair));
pair.push("again", 7, "more");
show("after three pushes, spread", () => pairText(...pair));
show("after three pushes, spread into two parameters", () => two(...pair));
pair.splice(0);
show("emptied, spread", () => pairText(...pair));
show("emptied, spread into two parameters", () => two(...pair));

show("optional tuple with one", () => optionalTuple(1));
show("optional tuple with two", () => optionalTuple(1, "x"));
show("optional tuple with undefined", () => optionalTuple(1, undefined));

const numbers: number[] = new Array<number>(3);
show("holes are spread", () => sum(...numbers));
show("holes are spread: count", () => ((...all: number[]) => all.length + " " + (0 in all))(...numbers));
show("apply with a tuple", () => two.apply(undefined, [2, "two"]));
show("Math.max of holes", () => Math.max(...numbers));
