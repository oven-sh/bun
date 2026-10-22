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

function popping(numbers: number[]): unknown[] {
  let sum = 0;
  let rounds = 0;
  for (let i = 0; i < numbers.length; i++) {
    rounds++;
    sum += numbers[i];
    numbers.pop();
  }
  return [rounds, sum];
}

function cachedBound(numbers: number[], cutAt: number): unknown[] {
  let sum = 0;
  const kinds: string[] = [];
  for (let i = 0, n = numbers.length; i < n; i++) {
    if (i === cutAt) numbers.length = cutAt;
    kinds.push(typeof numbers[i]);
    sum += numbers[i];
  }
  return [sum, kinds.join()];
}

function cachedBoundOfStrings(strings: string[], cutAt: number): number {
  let width = 0;
  for (let i = 0, n = strings.length; i < n; i++) {
    if (i === cutAt) strings.length = cutAt;
    width += strings[i].length;
  }
  return width;
}

function cachedBoundOfPoints(points: Point[], cutAt: number): number {
  let sum = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    if (i === cutAt) points.length = cutAt;
    sum += points[i].x;
  }
  return sum;
}

function cachedBoundOfFunctions(functions: (() => number)[], cutAt: number): number {
  let sum = 0;
  for (let i = 0, n = functions.length; i < n; i++) {
    if (i === cutAt) functions.length = cutAt;
    sum += functions[i]();
  }
  return sum;
}

function removeEven(numbers: number[]): number[] {
  for (let i = 0; i < numbers.length; i++) if (numbers[i] % 2 === 0) numbers.splice(i, 1);
  return numbers;
}

function shifting(strings: string[]): string {
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    strings.shift();
  }
  return text;
}

function emptiedUnderForOf(numbers: number[]): unknown[] {
  const seen: number[] = [];
  for (const n of numbers) {
    seen.push(n);
    if (n === 2) numbers.length = 0;
  }
  return [seen, numbers];
}

function backwards(numbers: number[]): unknown[] {
  const kinds: string[] = [];
  for (let i = numbers.length - 1; i >= 0; i--) {
    kinds.push(typeof numbers[i]);
    if (i === numbers.length - 1) numbers.length = Math.max(0, numbers.length - 2);
  }
  return [kinds.join(), numbers];
}

function cutByACallee(numbers: number[], cut: (list: number[]) => void): unknown[] {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += numbers[i];
    cut(numbers);
  }
  return [sum, numbers.length];
}

let total = 0;
for (let i = 0; i < 2000; i++) total += Number(cachedBound([i, 1, 2], 9)[0]) + cachedBoundOfStrings(["a", "b"], 9) + cachedBoundOfPoints([new Point(i)], 9) + cachedBoundOfFunctions([() => i], 9) + Number(cutByACallee([i, 1, 2], () => {})[0]);
console.log("2000 rounds in which nothing shrinks: " + total);

attempt("popped in the body", () => popping([1, 2, 3, 4, 5]));
attempt("cut, the bound was read once: integers", () => cachedBound([1, 2, 3, 4], 2));
attempt("cut, the bound was read once: fractions", () => cachedBound([0.5, 1.5, 2.5, 3.5], 1));
attempt("cut to nothing at once", () => cachedBound([1, 2], 0));
attempt("cut, the bound was read once: strings", () => cachedBoundOfStrings(["a", "b", "c"], 1));
attempt("cut, the bound was read once: points", () => cachedBoundOfPoints([new Point(1), new Point(2)], 1));
attempt("cut, the bound was read once: functions", () => cachedBoundOfFunctions([() => 1, () => 2], 1));
attempt("spliced in the body: one is skipped", () => removeEven([1, 2, 4, 6, 7, 8]));
attempt("shifted in the body", () => shifting(["a", "b", "c", "d", "e"]));
attempt("emptied under for of", () => emptiedUnderForOf([1, 2, 3, 4]));
attempt("backwards", () => backwards([1, 2, 3, 4, 5]));
attempt("cut by a function that is called in the body", () => cutByACallee([1, 2, 3], list => (list.length = 1)));
attempt("emptied by a function that is called in the body", () => cutByACallee([1.5, 2.5, 3.5], list => list.splice(0)));

export {};
