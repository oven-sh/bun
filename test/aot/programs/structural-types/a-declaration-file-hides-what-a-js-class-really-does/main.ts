import { Account, Frozen, Lazy, makeList, makeMap, makePromise } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function balanceOf(a: Account): number {
  return a.balance + 1;
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

attempt("honest", () => [plusOne(1), total([1, 2])]);
attempt("a field that is an accessor", () => {
  const a = new Account(10);
  return [balanceOf(a), balanceOf(a), balanceOf(a), balanceOf(a)];
});
attempt("a store that the setter doubles", () => {
  const a = new Account(10);
  a.balance = 5;
  return [a.balance, a.balance, a.balance];
});
attempt("read twice in one expression", () => {
  const a = new Account(1);
  return [a.balance + a.balance, a.balance + a.balance, a.balance + a.balance];
});
attempt("a method that answers the object", () => {
  const a = new Account(1);
  return [typeof a.deposit(1), plusOne(a.deposit(1))];
});
attempt("in a loop", () => {
  const a = new Account(1);
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += a.balance;
  return sum;
});
attempt("a frozen instance is stored to", () => {
  const f = new Frozen();
  f.size = 2;
  return f.size;
});
attempt("a frozen instance is incremented", () => {
  const f = new Frozen();
  f.size++;
  return f.size;
});
attempt("a member that removes itself", () => new Lazy().items);
attempt("a member that removes itself: used", () => total(new Lazy().items));
attempt("a list that is a subclass", () => {
  const list = makeList();
  return [total(list), list.push(4), list.length, list.map(plusOne), Array.isArray(list)];
});
attempt("a map that is a subclass", () => {
  const m = makeMap();
  const a = m.get("a");
  return [a, a === undefined ? -1 : plusOne(a), m.size];
});
console.log("a promise that is a thenable ->", show(plusOne(await makePromise())));
attempt("honest again", () => [plusOne(1), total([1, 2])]);
