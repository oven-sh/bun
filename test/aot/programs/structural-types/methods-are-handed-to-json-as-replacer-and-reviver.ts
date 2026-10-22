function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const log: string[] = [];

class Filter {
  hidden: string = "secret";
  factor: number = 10;
  replace(key: string, value: unknown): unknown {
    log.push("replace '" + key + "' this is " + (this === undefined ? "nothing" : this instanceof Filter ? "the filter" : Array.isArray(this) ? "an array" : "an object with " + Object.keys(this).join("+")));
    return key === this.hidden ? undefined : value;
  }
  revive(key: string, value: unknown): unknown {
    log.push("revive '" + key + "' this has " + Object.keys(this).join("+"));
    return typeof value === "number" ? value * this.factor : value;
  }
  toJSON(): string {
    return "filter hiding " + this.hidden;
  }
}

const filter = new Filter();
const data = { open: 1, secret: 2, hidden: "open", list: [3] };

show("replacer: the bare method", () => JSON.stringify(data, filter.replace));
show("log", () => log.splice(0).join(" | "));
show("replacer: bound", () => JSON.stringify(data, filter.replace.bind(filter)));
show("log", () => log.splice(0).join(" | "));
show("reviver: the bare method", () => JSON.stringify(JSON.parse('{"a":1,"factor":3,"b":2}', filter.revive)));
show("log", () => log.splice(0).join(" | "));
show("reviver: bound", () => JSON.stringify(JSON.parse('{"a":1,"factor":3,"b":2}', filter.revive.bind(filter))));
log.length = 0;
show("toJSON: honest", () => JSON.stringify(filter));
show("toJSON: borrowed by another object", () => JSON.stringify({ hidden: "borrowed", toJSON: filter.toJSON }));
show("toJSON: borrowed, nothing to hide", () => JSON.stringify({ toJSON: filter.toJSON }));
show("toJSON: bare", () => {
  const toJSON = filter.toJSON;
  return toJSON();
});

class Money {
  amount: number = 5;
  valueOf(): number {
    return this.amount;
  }
  toString(): string {
    return "$" + this.amount;
  }
}
const money = new Money();
const borrowed = { amount: 50, valueOf: money.valueOf, toString: money.toString };
const wrong = { amount: "many", valueOf: money.valueOf, toString: money.toString };
show("valueOf: honest", () => +money);
show("valueOf: borrowed", () => +borrowed);
show("valueOf: borrowed, wrong kind", () => +wrong);
show("toString: borrowed", () => `${borrowed}`);
show("toString: borrowed, wrong kind", () => String(wrong));
show("valueOf: bare", () => {
  const valueOf = money.valueOf;
  return valueOf();
});
show("join", () => [money, borrowed, wrong].join());
