function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Person {
  first: string = "ann";
}

const kept: Account[] = [];

class Account {
  id: number;
  balance: number;
  name: string;
  owner: Person;
  history: number[];
  ready: boolean = true;
  constructor(stopAfter: number) {
    kept.push(this);
    if (stopAfter === 0) throw new RangeError("stopped");
    this.id = 7;
    if (stopAfter === 1) throw new RangeError("stopped");
    this.balance = 1.5;
    if (stopAfter === 2) throw new RangeError("stopped");
    this.name = "acct";
    if (stopAfter === 3) throw new RangeError("stopped");
    this.owner = new Person();
    if (stopAfter === 4) throw new RangeError("stopped");
    this.history = [1];
  }
  worth(): number {
    return this.id + this.balance;
  }
  title(): string {
    return this.name.toUpperCase() + " of " + this.owner.first;
  }
  entries(): number {
    return this.history.length;
  }
}

for (let stop = 0; stop <= 5; stop++) {
  show("stop after " + stop, () => new Account(stop).id);
}

for (let i = 0; i < kept.length; i++) {
  const account = kept[i];
  show(i + " id", () => account.id);
  show(i + " balance", () => account.balance);
  show(i + " name", () => account.name);
  show(i + " owner", () => account.owner);
  show(i + " history", () => account.history);
  show(i + " ready", () => account.ready);
  show(i + " worth", () => account.worth());
  show(i + " title", () => account.title());
  show(i + " entries", () => account.entries());
  show(i + " keys", () => Object.keys(account).join());
  show(i + " JSON", () => JSON.stringify(account));
}

class Base {
  low: number = 1;
}
class Late extends Base {
  high: number = 2;
  constructor(fail: boolean) {
    if (fail) throw new RangeError("before super");
    super();
  }
}
show("thrown before super", () => new Late(true));
show("not thrown", () => new Late(false));

let total = 0;
for (const account of kept) total += account.balance;
show("all balances added", () => total);
let ids = 0;
for (const account of kept) ids += account.id | 0;
show("all ids added as whole numbers", () => ids);
