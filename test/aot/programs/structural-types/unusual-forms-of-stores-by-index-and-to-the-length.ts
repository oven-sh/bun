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

function state(list: unknown[]): string {
  return show(list) + " length " + list.length + " keys " + Object.keys(list).join();
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const a = [i, 1];
  a[0]++;
  a[1] += 2;
  [a[0], a[1]] = [a[1], a[0]];
  warm += sum(a);
}
console.log("2000 honest rounds: " + warm);

attempt("++ on a place past the end", () => {
  const a = [1, 2];
  const old = a[4]++;
  return [old, state(a), sum(a)];
});
attempt("+= on a hole", () => {
  const a = new Array<number>(2);
  a[0] += 1;
  return [state(a), typeof a[0], typeof a[1]];
});
attempt("+= on a hole of strings", () => {
  const a = new Array<string>(2);
  a[0] += "x";
  return state(a);
});
attempt("++ on the last of an empty list", () => {
  const a: number[] = [];
  a[a.length - 1]++;
  return [state(a), a[-1]];
});
attempt("??= past the end, on a hole and on a number", () => {
  const a = [1, 2];
  a[3] ??= 9;
  a[2] ??= 8;
  a[0] ??= 7;
  return state(a);
});
attempt("||= and &&= on zero and on a hole", () => {
  const a = [0, 1];
  a.length = 3;
  a[0] ||= 5;
  a[1] &&= 6;
  a[2] &&= 7;
  a[2] ||= 8;
  return state(a);
});
attempt("a pattern stores past the end", () => {
  const a = [1];
  [a[2], a[4]] = [3, 5];
  return [state(a), sum(a)];
});
attempt("a pattern takes from past the end", () => {
  const a = [1, 2];
  [a[0], a[1]] = [a[5], a[6]];
  return [state(a), sum(a), typeof a[0]];
});
attempt("for of appends", () => {
  const a: number[] = [];
  for (a[a.length] of [1, 2, 0.5]);
  return state(a);
});
attempt("for in stores its keys", () => {
  const a: string[] = [];
  for (a[a.length] in { x: 1, y: 2 });
  return state(a);
});
attempt("the index moves while the store runs", () => {
  const a = [1, 2, 3];
  let i = 0;
  a[i++] = a[i] + 10;
  a[i++] = a[i++] + 10;
  return [state(a), i];
});
attempt("the index is the result of a push", () => {
  const a = [1];
  a[a.push(2)] = 3;
  return state(a);
});
attempt("the value cuts the list", () => {
  const a = [1, 2, 3];
  a[2] = a.length = 1;
  return state(a);
});
attempt("length--, length++ and length += 2", () => {
  const a = [1, 2, 3];
  a.length--;
  const first = state(a);
  a.length++;
  const second = state(a);
  a.length += 2;
  return [first, second, state(a)];
});
attempt("length *= 2 and length >>= 1", () => {
  const a = ["a", "b"];
  a.length *= 2;
  const first = state(a);
  a.length >>= 2;
  return [first, state(a)];
});
attempt("length -= 5", () => {
  const a = [1, 2];
  a.length -= 5;
  return state(a);
});
attempt("length /= 4", () => {
  const a = [1, 2];
  a.length /= 4;
  return state(a);
});
attempt("a pattern stores to the length", () => {
  const a = [1, 2, 3];
  [a.length] = [1];
  const first = state(a);
  ({ length: a.length } = "four");
  return [first, state(a)];
});
attempt("delete does not cut", () => {
  const a = [1, 2, 3];
  delete a[a.length - 1];
  return [state(a), typeof a[a.length - 1], sum(a)];
});
attempt("a store at the index that a deleted element had", () => {
  const a = ["a", "b", "c"];
  delete a[1];
  const before = state(a);
  a[1] = "again";
  return [before, state(a)];
});

export {};
