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

function firstTwice(list: ReadonlyArray<number>, change: () => void): number[] {
  const before = list[0];
  change();
  return [before, list[0]];
}

function lengthTwice(list: readonly number[], change: () => void): number[] {
  const before = list.length;
  change();
  return [before, list.length];
}

function sumWhileChanging(list: readonly number[], change: (index: number) => void): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i];
    change(i);
  }
  return total;
}

function sumByForOfWhileChanging(list: readonly number[], change: (value: number) => void): number {
  let total = 0;
  for (const value of list) {
    total += value;
    change(value);
  }
  return total;
}

function lastAfter(list: readonly number[], change: () => void): unknown[] {
  const index = list.length - 1;
  change();
  return [index in list, list[index], typeof list[index]];
}

function kindsAfter(list: readonly number[], change: () => void): string {
  change();
  return list.map(value => typeof value).join();
}

class Ledger {
  private entries: number[] = [1, 2, 3];
  get view(): readonly number[] {
    return this.entries;
  }
  add(value: number): void {
    this.entries.push(value);
  }
  clear(): void {
    this.entries.length = 0;
  }
}

let warm = 0;
const still: readonly number[] = [1, 2, 3];
for (let i = 0; i < 2000; i++) {
  warm += firstTwice(still, () => {})[1] + lengthTwice(still, () => {})[1] + sumWhileChanging(still, () => {}) + sumByForOfWhileChanging(still, () => {});
}
console.log("after 2000 arrays that stay", warm);

attempt("the first element is stored to", () => {
  const list = [1, 2, 3];
  return firstTwice(list, () => void (list[0] = 100));
});
attempt("the first element is shifted away", () => {
  const list = [1, 2, 3];
  return firstTwice(list, () => void list.shift());
});
attempt("the array is emptied", () => {
  const list = [1, 2, 3];
  return firstTwice(list, () => void (list.length = 0));
});
attempt("pushed", () => {
  const list = [1, 2, 3];
  return lengthTwice(list, () => void list.push(4, 5));
});
attempt("popped", () => {
  const list = [1, 2, 3];
  return lengthTwice(list, () => void list.pop());
});
attempt("grows during the loop", () => {
  const list = [1, 2, 3];
  return sumWhileChanging(list, index => void (index < 3 && list.push(10)));
});
attempt("shrinks during the loop", () => {
  const list = [1, 2, 3, 4, 5, 6];
  return sumWhileChanging(list, () => void list.pop());
});
attempt("later elements change during the loop", () => {
  const list = [1, 2, 3];
  return sumWhileChanging(list, index => void (index < 2 && (list[index + 1] = 0.5)));
});
attempt("grows during the for-of", () => {
  const list = [1, 2, 3];
  return sumByForOfWhileChanging(list, value => void (value < 3 && list.push(10)));
});
attempt("shrinks during the for-of", () => {
  const list = [1, 2, 3, 4, 5, 6];
  return sumByForOfWhileChanging(list, () => void list.pop());
});
attempt("the last element is popped", () => {
  const list = [1, 2, 3];
  return lastAfter(list, () => void list.pop());
});
attempt("the last element is deleted", () => {
  const list = [1, 2, 3];
  return lastAfter(list, () => void delete list[2]);
});
attempt("a string arrives through a second, wider alias", () => {
  const list = [1, 2, 3];
  const wide: (number | string)[] = list;
  return kindsAfter(list, () => void wide.push("x"));
});
attempt("a view of a private array", () => {
  const ledger = new Ledger();
  const view = ledger.view;
  const seen = [view.length, sumWhileChanging(view, index => void (index === 0 && ledger.add(10)))];
  ledger.clear();
  return [...seen, view.length, view[0]];
});
attempt("a readonly tuple", () => {
  const pair: [number, number] = [1, 2];
  const fixed: readonly [number, number] = pair;
  const before = fixed[0] + fixed[1];
  pair[0] = 10;
  pair.reverse();
  return [before, fixed[0], fixed[1]];
});
attempt("a constant array made with as const is frozen by nobody", () => {
  const list = [1, 2, 3];
  const view: readonly number[] = list;
  list.sort((a, b) => b - a);
  return [view[0], view.at(-1), view.indexOf(3)];
});
