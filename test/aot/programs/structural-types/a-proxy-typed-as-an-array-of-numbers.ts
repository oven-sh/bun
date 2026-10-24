function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

function watched(target: number[]): number[] {
  return new Proxy(target, {
    get: (inner, key, receiver) => (log.push("get:" + String(key)), Reflect.get(inner, key, receiver)),
    set: (inner, key, value, receiver) => (log.push("set:" + String(key)), Reflect.set(inner, key, value, receiver)),
    has: (inner, key) => (log.push("has:" + String(key)), Reflect.has(inner, key)),
    deleteProperty: (inner, key) => (log.push("delete:" + String(key)), Reflect.deleteProperty(inner, key)),
  });
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

const uses: [string, (numbers: number[]) => unknown][] = [
  ["sum", sum],
  ["sum by for-of", sumByForOf],
  ["length", numbers => numbers.length],
  ["[1]", numbers => numbers[1]],
  ["[5]", numbers => numbers[5]],
  ["[1] = 9", numbers => (numbers[1] = 9)],
  ["push", numbers => numbers.push(4)],
  ["pop", numbers => numbers.pop()],
  ["shift", numbers => numbers.shift()],
  ["length = 1", numbers => (numbers.length = 1)],
  ["map", numbers => numbers.map(number => number * 2)],
  ["indexOf", numbers => numbers.indexOf(3)],
  ["includes", numbers => numbers.includes(3)],
  ["join", numbers => numbers.join("-")],
  ["reverse", numbers => sum(numbers.reverse())],
  ["spread", numbers => [...numbers]],
  ["a pattern", numbers => {
    const [first, second] = numbers;
    return [first, second];
  }],
  ["Math.max", numbers => Math.max(...numbers)],
  ["concat", numbers => [0].concat(numbers)],
  ["1 in", numbers => 1 in numbers],
  ["delete [1]", numbers => delete numbers[1]],
  ["isArray", numbers => Array.isArray(numbers)],
  ["instanceof", numbers => numbers instanceof Array],
  ["JSON", numbers => JSON.stringify(numbers)],
  ["keys", numbers => Object.keys(numbers)],
  ["Array.from", numbers => Array.from(numbers)],
  ["a Float64Array", numbers => new Float64Array(numbers).length],
];
for (const [, use] of uses) for (let i = 0; i < 500; i++) use([1, 2, 3]);
console.log("after 500 honest arrays at every use");

for (const [name, use] of uses) logged(name, () => use(watched([1, 2, 3])));
logged("a proxy whose elements are doubled", () => {
  const doubled = new Proxy([1, 2, 3], { get: (inner, key, receiver) => (typeof key === "string" && /^\d+$/.test(key) ? inner[Number(key)] * 2 : Reflect.get(inner, key, receiver)) });
  return [sum(doubled), sumByForOf(doubled), doubled.map(number => number), [...doubled]];
});
logged("a proxy that claims a longer length", () => {
  const longer = new Proxy([1, 2, 3], { get: (inner, key, receiver) => (key === "length" ? 5 : Reflect.get(inner, key, receiver)) });
  return [longer.length, sum(longer), [...longer], longer.map(number => number).length];
});
logged("a proxy whose elements are strings", () => {
  const texts = new Proxy([1, 2, 3], { get: (inner, key, receiver) => (typeof key === "string" && /^\d+$/.test(key) ? "s" + key : Reflect.get(inner, key, receiver)) });
  return [sum(texts), typeof texts[0], texts[0] * 2];
});
logged("a proxy among arrays", () => [[1, 2], watched([3, 4]), [5, 6]].map(sum));
