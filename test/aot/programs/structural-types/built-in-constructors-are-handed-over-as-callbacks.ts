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

function kinds(list: unknown[]): string {
  return list.map(v => (Array.isArray(v) ? "array(" + v.length + ")" : v instanceof Object ? Object.prototype.toString.call(v) : typeof v + " " + String(v))).join(", ");
}

const texts = ["1", "", "x", "2.5"];
const numbers = [0, 1, 2.5, NaN];

show("map Number", () => kinds(texts.map(Number)));
show("map String", () => kinds(numbers.map(String)));
show("map Boolean", () => kinds(numbers.map(Boolean)));
show("filter Boolean", () => kinds(numbers.filter(Boolean)));
show("filter Boolean on strings", () => kinds(texts.filter(Boolean)));
show("map Object", () => kinds(numbers.map(Object)));
show("map Array", () => kinds([1, 2].map(Array)));
show("map BigInt", () => kinds([1, 2].map(BigInt)));
show("map BigInt with a fraction", () => kinds(numbers.map(BigInt)));
show("map Symbol", () => [1, 2].map(Symbol).map(s => typeof s + " " + s.description).join());
show("map Error", () => ["a", "b"].map(Error).map(e => e.constructor.name + " " + e.message).join());
show("map RegExp", () => ["a", "b"].map(s => RegExp(s)).map(r => r.source).join());
show("map Date", () => [1, 2].map(Date).map(d => typeof d).join());
show("Array.from Number", () => kinds(Array.from(texts, Number)));
show("Array.from String", () => kinds(Array.from(numbers, String)));
show("Array.from length and Number", () => kinds(Array.from({ length: 2 }, Number)));
show("Array.from length and String", () => kinds(Array.from({ length: 2 }, String)));
show("some Boolean", () => numbers.some(Boolean));
show("every Boolean", () => numbers.every(Boolean));
show("find Boolean", () => numbers.find(Boolean));
show("findIndex Number", () => texts.findIndex(Number));
show("flatMap Array", () => kinds([1, 2].flatMap(Array)));
show("sort by a comparator made of Math", () => kinds([3, 1, 2].sort(Math.min)));
show("replace with String", () => "abc".replace("b", String));

const convert: ((v: string) => unknown)[] = [Number, String, Boolean, Object, Symbol, parseFloat, JSON.parse, encodeURIComponent];
for (const f of convert) {
  show("'12' through " + f.name, () => {
    const value = f("12");
    return typeof value === "symbol" ? "symbol" : typeof value === "object" ? Object.prototype.toString.call(value) : value;
  });
}

const both: NumberConstructor = Number;
show("called", () => typeof both("5"));
show("constructed", () => typeof new both("5"));
show("constructed plus one", () => new both("5").valueOf() + 1);
const dates: DateConstructor = Date;
show("Date called", () => typeof dates());
show("Date constructed", () => new dates(0).getTime());

Promise.resolve("42")
  .then(Number)
  .then(value => console.log("then Number: " + typeof value + " " + value));
