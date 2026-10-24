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

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

function cutAndGrow<T>(list: T[], short: number, long: number): T[] {
  list.length = short;
  list.length = long;
  return list;
}

function lastPlusOne(numbers: number[]): number {
  return numbers[numbers.length - 1] + 1;
}

function study<T>(title: string, make: () => T[]): void {
  attempt(title + ": cut to 1, made 3 long", () => cutAndGrow(make(), 1, 3));
  attempt(title + ": what was cut off does not come back", () => {
    const list = cutAndGrow(make(), 1, 3);
    return [typeof list[1], typeof list[2], 1 in list, 2 in list, Object.keys(list)];
  });
  attempt(title + ": cut to 0, made 3 long", () => cutAndGrow(make(), 0, 3));
  attempt(title + ": popped twice, made 3 long", () => {
    const list = make();
    list.pop();
    list.pop();
    list.length = 3;
    return [list, typeof list[2]];
  });
  attempt(title + ": spliced, made 3 long", () => {
    const list = make();
    list.splice(1);
    list.length = 3;
    return [list, typeof list[1]];
  });
  attempt(title + ": shifted, made 3 long", () => {
    const list = make();
    list.shift();
    list.length = 3;
    return [list, typeof list[2]];
  });
  attempt(title + ": cut, then a store past the end", () => {
    const list = make();
    const kept = list[0];
    list.length = 1;
    list[2] = kept;
    return [list, typeof list[1], list.length];
  });
  attempt(title + ": cut, then pushed to", () => {
    const list = make();
    const kept = list[0];
    list.length = 1;
    list.push(kept);
    list.length = 3;
    return list;
  });
}

let total = 0;
for (let i = 0; i < 2000; i++) total += lastPlusOne([i, i + 1]) + cutAndGrow([i, 2, 3], 3, 3).length;
console.log("2000 honest rounds: " + total);

study("integers", () => [11, 22, 33]);
study("fractions", () => [1.5, 2.5, 3.5]);
study("strings", () => ["a", "b", "c"]);
study("points", () => [new Point(1), new Point(2), new Point(3)]);
study("functions", () => [() => 1, () => 2, () => 3]);
study("booleans", () => [true, true, true]);
study("lists", () => [[1], [2], [3]]);

attempt("integers: the last one + 1 after the cut", () => lastPlusOne(cutAndGrow([11, 22, 33], 1, 3)));
attempt("fractions: the last one + 1 after the cut", () => lastPlusOne(cutAndGrow([1.5, 2.5, 3.5], 1, 3)));
attempt("a long list is cut and made long again", () => {
  const list: number[] = [];
  for (let i = 0; i < 1000; i++) list.push(i);
  cutAndGrow(list, 10, 1000);
  let present = 0;
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    if (i in list) present++;
    if (list[i] !== undefined) sum += list[i];
  }
  return [present, sum, typeof list[999], list.length];
});

export {};
