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

function found(numbers: number[], wanted: number): number {
  return numbers[numbers.indexOf(wanted)];
}

function foundText(strings: string[], wanted: string): string {
  return strings[strings.indexOf(wanted)];
}

function foundPoint(points: Point[], x: number): Point {
  return points[points.findIndex(p => p.x === x)];
}

function after(numbers: number[], wanted: number): number {
  return numbers[numbers.indexOf(wanted) + 1];
}

function remove(numbers: number[], wanted: number): number[] {
  numbers.splice(numbers.indexOf(wanted), 1);
  return numbers;
}

function replace(numbers: number[], wanted: number, by: number): number[] {
  numbers[numbers.indexOf(wanted)] = by;
  return numbers;
}

function letterAfter(text: string, wanted: string): string {
  return text[text.indexOf(wanted) + wanted.length];
}

function letterAt(text: string, wanted: string): string {
  return text[text.indexOf(wanted)];
}

function cutAt(text: string, wanted: string): string {
  return text.slice(0, text.indexOf(wanted));
}

function extension(name: string): string {
  return name.substring(name.lastIndexOf(".") + 1);
}

let total = 0;
for (let i = 0; i < 2000; i++) total += found([i, 1], i) + foundText(["a", "b"], "b").length + foundPoint([new Point(i)], i).x + after([i, 5], i) + letterAt("abc", "b").length;
console.log("2000 honest rounds: " + total);

attempt("numbers", () => [found([1, 2], 2), typeof found([1, 2], 3), found([1, 2], 3) + 1, found([0.5], 1) * 2]);
attempt("not a number is never found", () => [typeof found([NaN], NaN), [NaN].indexOf(NaN), [NaN].includes(NaN), [NaN].findIndex(n => Number.isNaN(n))]);
attempt("zero and minus zero", () => [[0].indexOf(-0), [-0].indexOf(0), show(found([-0], 0)), [-0].includes(0)]);
attempt("holes are never found", () => [new Array<number | undefined>(2).indexOf(undefined), new Array<number | undefined>(2).includes(undefined), new Array<number | undefined>(2).findIndex(n => n === undefined)]);
attempt("strings", () => [foundText(["a"], "a"), typeof foundText(["a"], "z"), foundText(["a"], "z") + "!"]);
attempt("strings: a method", () => foundText(["a"], "z").length);
attempt("points", () => [foundPoint([new Point(1)], 1).x, typeof foundPoint([new Point(1)], 2)]);
attempt("points: a member", () => foundPoint([new Point(1)], 2).x);
attempt("the one after", () => [after([1, 2], 1), typeof after([1, 2], 2), after([1, 2], 9)]);
attempt("a miss removes the last one", () => [remove([1, 2, 3], 2), remove([1, 2, 3], 9), remove([], 9)]);
attempt("a miss stores at minus one", () => {
  const numbers = replace([1, 2], 9, 5);
  return [show(numbers), Object.keys(numbers), numbers.length, found(numbers, 100)];
});
attempt("letters", () => [letterAt("abc", "b"), typeof letterAt("abc", "z"), letterAfter("abc", "b"), typeof letterAfter("abc", "c"), letterAfter("abc", "z"), letterAfter("abc", "")]);
attempt("letters: a method", () => letterAt("abc", "z").toUpperCase());
attempt("a miss cuts the last letter off", () => [cutAt("a,b", ","), cutAt("ab", ","), cutAt("", ",")]);
attempt("extensions", () => [extension("a.ts"), extension("none"), extension("a."), extension(".hidden"), extension("")]);
attempt("from an odd start", () => [[1, 2, 1].indexOf(1, 1), [1, 2, 1].indexOf(1, -1), [1, 2, 1].indexOf(1, 99), [1, 2, 1].indexOf(1, -99), [1, 2, 1].indexOf(1, 0.9), [1, 2, 1].indexOf(1, NaN), [1, 2, 1].lastIndexOf(1, -2), [1, 2, 1].lastIndexOf(1, -99), "aba".indexOf("a", 1), "aba".indexOf("a", 99), "aba".indexOf("", 99), "aba".lastIndexOf("a", -5)]);
attempt("search", () => ["abc".search(/z/), typeof "abc"["abc".search(/z/)], "abc"["abc".search(/c/)]]);

export {};
