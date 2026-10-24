function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

class Money {
  amount: number = 0;
  currency: string = "EUR";
  #secret = 7;
  static is(value: object): boolean {
    return #secret in value;
  }
  twice(): number {
    return this.amount * 2;
  }
  get label(): string {
    return this.amount + " " + this.currency;
  }
  secret(): number {
    return this.#secret;
  }
}

function amountOf(money: Money): number {
  return money.amount;
}
function twiceOf(money: Money): number {
  return money.twice();
}
function labelOf(money: Money): string {
  return money.label;
}
function secretOf(money: Money): number {
  return money.secret();
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const money = new Money();
  money.amount = i;
  warm += amountOf(money) + twiceOf(money) + labelOf(money).length + secretOf(money);
}
console.log("2000 honest instances", warm);

for (const text of ['{"amount":5,"currency":"USD"}', '{"currency":"USD","amount":5}', '{"amount":"5"}', "{}", '{"amount":5,"currency":"USD","twice":1,"label":"own"}', "[]", "null"]) {
  attempt(text + " fields", () => {
    const money: Money = JSON.parse(text);
    return [amountOf(money), money.currency, Object.keys(money), money instanceof Money, Money.is(money)];
  });
  attempt(text + " a method", () => {
    const money: Money = JSON.parse(text);
    return twiceOf(money);
  });
  attempt(text + " a getter", () => {
    const money: Money = JSON.parse(text);
    return [labelOf(money), typeof labelOf(money)];
  });
  attempt(text + " a private name", () => {
    const money: Money = JSON.parse(text);
    return secretOf(money);
  });
  attempt(text + " the method of the class on it", () => {
    const money: Money = JSON.parse(text);
    return [Money.prototype.twice.call(money), Money.prototype.secret.call(money)];
  });
}
attempt("given the prototype afterwards", () => {
  const money: Money = Object.setPrototypeOf(JSON.parse('{"currency":"USD","amount":5}'), Money.prototype);
  return [amountOf(money), twiceOf(money), labelOf(money), money instanceof Money, Money.is(money), Object.keys(money)];
});
attempt("given the prototype afterwards, a private name", () => {
  const money: Money = Object.setPrototypeOf(JSON.parse('{"amount":5}'), Money.prototype);
  return secretOf(money);
});
attempt("honest again", () => {
  const money = new Money();
  return [amountOf(money), twiceOf(money), labelOf(money), secretOf(money)];
});
