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

function scaled(n: number, index?: number, scale?: number): number {
  return n * (scale ?? 1);
}
function shifted(n: number, index?: number, shift?: number): number {
  return shift === undefined ? n : n + shift;
}
function kinds(n: number, index?: number, extra?: number): string {
  return typeof index + "/" + typeof extra;
}
function whole(n: number, index?: number, extra: number = 0): number {
  return (n + extra) | 0;
}
function add(sum: number, n: number, bonus?: number, factor?: number): number {
  return sum + n + (bonus ?? 0) * 1000 + (factor === undefined ? 0 : factor * 0);
}
function compare(a: number, b: number, bias?: number): number {
  return a - b + (bias ?? 0);
}
function offsetOf(match: string, offset?: boolean): string {
  return match + ":" + typeof offset + ":" + (offset ? "yes" : "no") + ":" + (offset === true);
}

const scaledShort: (n: number) => number = scaled;
const shiftedShort: (n: number) => number = shifted;
const kindsShort: (n: number) => string = kinds;
const wholeShort: (n: number) => number = whole;
const addShort: (sum: number, n: number) => number = add;
const compareShort: (a: number, b: number) => number = compare;
const offsetShort: (match: string) => string = offsetOf;

const numbers = [3, 1, 2];

show("honest scaled", () => scaled(2, 0, 10));
show("honest shifted", () => shifted(2, 0, 10));
show("honest whole", () => whole(2, 0, 10));
show("honest add", () => add(1, 2, 3, 4));
show("map scaled", () => numbers.map(scaledShort));
show("map shifted", () => numbers.map(shiftedShort));
show("map kinds", () => numbers.map(kindsShort));
show("map whole", () => numbers.map(wholeShort));
show("typed array map scaled", () => Array.from(new Float64Array(numbers).map(scaledShort)));
show("typed array map shifted", () => Array.from(new Float64Array(numbers).map(shiftedShort)));
show("Array.from kinds", () => Array.from(numbers, kindsShort));
show("Array.from shifted", () => Array.from(numbers, shiftedShort));
show("reduce add", () => numbers.reduce(addShort, 0));
show("reduce add without a start", () => numbers.reduce(addShort));
show("reduceRight add", () => numbers.reduceRight(addShort, 0));
show("sort compare", () => [...numbers].sort(compareShort));
show("toSorted compare", () => numbers.toSorted(compareShort));
show("replace offset", () => "abc".replace("a", offsetShort));
show("replace offset further on", () => "abc".replace("c", offsetShort));
show("replace offset with a group", () => "abc".replace(/(c)/, offsetShort));

let total = 0;
for (let i = 0; i < 2000; i++) total += shifted(i, i, 1);
show("2000 honest calls", () => total);
show("map shifted after them", () => numbers.map(shiftedShort));
show("honest shifted again", () => shifted(2, 0, 10));
