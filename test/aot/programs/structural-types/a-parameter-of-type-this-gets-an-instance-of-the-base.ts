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

class Money {
  amount: number;
  constructor(amount: number) {
    this.amount = amount;
  }
  equals(other: this): boolean {
    return other.amount === this.amount;
  }
  plus(other: this): number {
    return this.amount + other.amount;
  }
}

class Priced extends Money {
  currency: string;
  rate: number;
  convert: () => number;
  constructor(amount: number, currency: string, rate: number) {
    super(amount);
    this.currency = currency;
    this.rate = rate;
    this.convert = () => this.amount * this.rate;
  }
  equals(other: this): boolean {
    return other.amount === this.amount && other.currency.toLowerCase() === this.currency.toLowerCase();
  }
  plus(other: this): number {
    return this.amount * this.rate + other.amount * other.rate;
  }
  both(other: this): number {
    return this.convert() + other.convert();
  }
}

function same(a: Money, b: Money): boolean {
  return a.equals(b);
}

function added(a: Money, b: Money): number {
  return a.plus(b);
}

let count = 0;
for (let i = 0; i < 2000; i++) {
  if (same(new Priced(i, "EUR", 2), new Priced(i, "eur", 2))) count++;
  if (same(new Money(i), new Money(i))) count++;
  count += added(new Priced(1, "a", 0.5), new Priced(1, "b", 0.5)) + added(new Money(1), new Money(1));
}
console.log("2000 honest rounds: " + count);

const priced = new Priced(5, "EUR", 1.5);
const plain = new Money(5);
const seenAsBase: Money = priced;

attempt("base and base", () => [same(plain, plain), added(plain, plain)]);
attempt("base and subclass", () => [same(plain, priced), added(plain, priced)]);
attempt("subclass and subclass", () => [same(priced, priced), added(priced, priced), priced.both(priced)]);
attempt("subclass.equals(base)", () => same(priced, plain));
attempt("subclass.equals(base), another amount", () => same(priced, new Money(6)));
attempt("subclass.plus(base)", () => added(priced, plain));
attempt("called on a variable of the base type", () => seenAsBase.equals(plain));
attempt("called on a variable of the base type: plus", () => seenAsBase.plus(plain));
attempt("a literal of the base's shape", () => {
  const literal: Money = { amount: 5, equals: () => true, plus: () => 0 };
  return [added(priced, literal), added(literal, priced), same(literal, priced)];
});
attempt("a literal of the base's shape: equals", () => {
  const literal: Money = { amount: 5, equals: () => true, plus: () => 0 };
  return same(priced, literal);
});
attempt("honest again", () => [same(priced, new Priced(5, "eur", 9)), added(priced, priced)]);

export {};
