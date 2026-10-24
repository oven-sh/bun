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

function at<T>(list: T[], index: number): T | undefined {
  return list.at(index);
}

function orZero(numbers: number[], index: number): number {
  return numbers.at(index) ?? 0;
}

function changed<T>(list: T[], index: number, item: T): T[] {
  return list.with(index, item);
}

let total = 0;
for (let i = 0; i < 2000; i++) total += orZero([i, 1, 2], i % 3) + orZero([i], -1) + changed([i, 1], 1, 5)[1];
console.log("2000 honest rounds: " + total);

const indexes = [0, 2, 3, -1, -3, -4, 1.9, -1.9, -0.5, -0, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1, -(2 ** 32), 2 ** 53];
for (const index of indexes) {
  attempt("at " + show(index), () => [at([10, 20, 30], index), at([0.5, 1.5, 2.5], index), at(["a", "b", "c"], index), orZero([10, 20, 30], index), "abc".at(index), new Int8Array([1, 2, 3]).at(index)]);
  attempt("with " + show(index), () => changed([10, 20, 30], index, 7));
  attempt("with, typed array " + show(index), () => Array.from(new Int8Array([1, 2, 3]).with(index, 7)));
}

attempt("at of holes", () => [at(new Array<number>(2), 0), at(new Array<number>(2), -1), orZero(new Array<number>(2), 0)]);
attempt("with fills holes with undefined", () => {
  const list = changed(new Array<number>(3), 1, 5);
  return [show(list), 0 in list, typeof list[0], list[0] + 1];
});
attempt("with puts a fraction among integers", () => {
  const before = [1, 2, 3];
  const after = changed(before, 1, 0.5);
  return [before, after, after[0] + after[1]];
});
attempt("with at a wider type argument", () => {
  const numbers = [1, 2, 3];
  const mixed = changed<number | string>(numbers, 0, "text");
  return [numbers, mixed, typeof mixed[0]];
});
attempt("toSpliced, toSorted and toReversed fill holes too", () => {
  const holes = new Array<number>(2);
  return [show(holes.toSpliced(0, 0)), show(holes.toSorted()), show(holes.toReversed()), show(holes.slice())];
});
attempt("slice with odd bounds", () => [[1, 2, 3].slice(-1), [1, 2, 3].slice(1.9), [1, 2, 3].slice(NaN), [1, 2, 3].slice(-Infinity, Infinity), [1, 2, 3].slice(2, 1), [1, 2, 3].slice(-0), [1, 2, 3].slice(2 ** 32)]);
attempt("an at() that is used without a check of undefined", () => {
  const value = at([1, 2], 5);
  return [typeof value, value === undefined ? "nothing" : value + 1];
});

export {};
