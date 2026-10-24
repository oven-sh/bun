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

type Three = (a: number, b: string, c: boolean) => string;

const none: Three = () => "none";
const one: Three = a => "one " + a;
const two: Three = (a, b) => "two " + a + b;
const counted: Three = function () {
  return "counted " + arguments.length + " " + Array.from(arguments).join("/");
};
const rest: Three = (...all) => "rest " + all.length + " " + all.join("/");
const restAfterOne: Three = (a, ...more) => "more " + a + " " + more.length + " " + more.join("/");
function declaredOne(a: number): string {
  return "declared " + a + " " + arguments.length;
}
const declared: Three = declaredOne;

const all: [string, Three][] = [
  ["none", none],
  ["one", one],
  ["two", two],
  ["counted", counted],
  ["rest", rest],
  ["restAfterOne", restAfterOne],
  ["declared", declared],
];

for (const [label, f] of all) {
  show(label + " called", () => f(1, "x", true));
  show(label + " length", () => f.length);
  show(label + " by call", () => f.call(undefined, 2, "y", false));
  show(label + " by apply", () => f.apply(undefined, [3, "z", true]));
}

show("honest call of the declared one", () => declaredOne(9));
show("map with no parameter", () => [5, 6].map(() => 1));
show("map counting arguments", () => [5, 6].map(function () {
  return arguments.length;
}));
show("forEach with one", () => {
  let sum = 0;
  [5, 6].forEach(n => {
    sum += n;
  });
  return sum;
});
show("sort with one parameter", () => [3, 1, 2].sort(a => a - 2));
show("reduce with one parameter", () => [3, 1, 2].reduce(sum => sum + 1, 0));
show("parseInt as a callback", () => ["10", "10", "10", "10"].map(parseInt));
show("Number as a callback", () => ["10", "x", ""].map(Number));
const fromCode: (code: number) => string = String.fromCharCode;
const maxOfOne: (a: number) => number = Math.max;
const maxOfTwo: (a: number, b: number) => number = Math.max;
show("String.fromCharCode as a callback", () => [65, 66].map(fromCode).map(s => s.length));
show("Math.max as a callback", () => [1, 5].map(maxOfOne).map(n => String(n)));
show("Math.max as a reducer", () => [1, 5, 3].reduce(maxOfTwo).toString());
