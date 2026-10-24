function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

type Pair = readonly [1, "one"];
type Flags = readonly [true, false];

function numberOf(pair: Pair): 1 {
  return pair[0];
}
function textOf(pair: Pair): "one" {
  return pair[1];
}
function sumOf(pair: Pair): number {
  return pair[0] + pair[1].length + pair.length;
}
function both(flags: Flags): string {
  return (flags[0] ? "yes" : "no") + (flags[1] ? "yes" : "no");
}
function spreadOf(pair: Pair): unknown[] {
  const [first, second] = pair;
  return [first, second, [...pair]];
}

let warm = 0;
const honest: Pair = [1, "one"];
for (let i = 0; i < 2000; i++) warm += numberOf(honest) + textOf(honest).length + sumOf(honest);
console.log("2000 honest rounds", warm);

attempt("Reflect.set of the number", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, 0, 2.5);
  return [numberOf(pair), numberOf(pair) === 1, sumOf(pair), spreadOf(pair)];
});
attempt("Reflect.set of the text", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, 1, "fifteen");
  return [textOf(pair), textOf(pair) === "one", sumOf(pair), spreadOf(pair)];
});
attempt("the two change places", () => {
  const pair: Pair = [1, "one"];
  Object.assign(pair, { 0: "one", 1: 1 });
  return [numberOf(pair), textOf(pair), typeof numberOf(pair), spreadOf(pair)];
});
attempt("the two change places and are used", () => {
  const pair: Pair = [1, "one"];
  Object.assign(pair, { 0: "one", 1: 1 });
  return sumOf(pair);
});
attempt("the length is cut", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, "length", 1);
  return [pair.length, textOf(pair), spreadOf(pair)];
});
attempt("the length is cut and the text is used", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, "length", 1);
  return sumOf(pair);
});
attempt("the length is raised", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, "length", 4);
  return [pair.length, sumOf(pair), spreadOf(pair)];
});
attempt("flags are flipped", () => {
  const flags: Flags = [true, false];
  Reflect.set(flags, 0, false);
  Reflect.set(flags, 1, true);
  return [both(flags), flags[0] === true, flags];
});
attempt("sorted through a wider name", () => {
  const list: [3, 1, 2] = [3, 1, 2];
  const wide: number[] = list;
  wide.sort();
  const first: 3 = list[0];
  return [first, first === 3, list];
});
attempt("honest again", () => [numberOf(honest), textOf(honest), sumOf(honest), both([true, false])]);
