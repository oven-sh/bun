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

class Account {
  balance = 100;
  rate = 0.25;
  owner = "ann";
  interest(): number {
    return this.balance * this.rate;
  }
  title(): string {
    return this.owner.toUpperCase();
  }
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function describe(a: Account): string {
  return typeof a.balance + " " + show(a.balance) + ", " + typeof a.rate + " " + show(a.rate) + ", " + typeof a.owner + " " + show(a.owner) + ", " + JSON.stringify(a);
}

function deposit(a: Account, amount: number): void {
  set(a, "balance", a.balance + amount);
}

function newRate(a: Account, rate: number): void {
  set(a, "rate", rate);
}

function newOwner(a: Account, owner: string): void {
  set(a, "owner", owner);
}

function fromAForm(a: Account, field: "balance" | "rate" | "owner", text: string): void {
  set(a, field, text);
}

function report(title: string, a: Account): void {
  console.log(title + ": " + describe(a));
  attempt("  interest", () => a.interest());
  attempt("  title", () => a.title());
  attempt("  balance + 1", () => a.balance + 1);
}

const honest = new Account();
const odd = new Account();
let total = 0;
for (let i = 0; i < 2000; i++) {
  deposit(honest, 1);
  newRate(honest, i / 4000);
  newOwner(honest, "o" + (i % 10));
  total += honest.interest() + honest.title().length;
}
console.log("2000 honest rounds: " + total);
report("the honest account", honest);
fromAForm(odd, "owner", "bob");
report("the form sets the owner", odd);
fromAForm(odd, "balance", "250");
report("the form sets the balance", odd);
deposit(odd, 1);
report("a deposit on top of it", odd);
fromAForm(odd, "rate", "0.5");
report("the form sets the rate", odd);
newRate(odd, 0.5);
set(odd, "balance", 10);
report("honest again", odd);
deposit(honest, 1);
report("the honest account once more", honest);

export {};
