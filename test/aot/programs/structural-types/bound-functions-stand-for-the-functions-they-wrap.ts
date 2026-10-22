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

class Account {
  balance: number = 10;
  name: string = "acct";
  add(amount: number, bonus: number): number {
    this.balance += amount + bonus;
    return this.balance;
  }
  title(): string {
    return this.name.toUpperCase();
  }
}

function area(this: { scale: number }, w: number, h: number): number {
  return this.scale * w * h;
}
function plain(a: number, b: number, c: number): string {
  return a + "," + b + "," + c;
}
function Legacy(this: { made: number }): void {
  this.made = 1;
}

const account = new Account();
const add = account.add.bind(account);
const addFive = account.add.bind(account, 5);
const addFiveOne = account.add.bind(account, 5, 1);
const title = account.title.bind(account);
const rebound = title.bind(new Account());
const scaled = area.bind({ scale: 2 });
const scaledThree = area.bind({ scale: 2 }, 3);
const partial = plain.bind(null, 1);
const twicePartial = partial.bind(null, 2);

function run2(f: (a: number, b: number) => number): number {
  return f(1, 2);
}
function run0(f: () => string): string {
  return f();
}

show("add", () => add(1, 2));
show("addFive", () => addFive(1));
show("addFiveOne", () => addFiveOne());
show("balance", () => account.balance);
show("title", () => title());
account.name = "renamed";
show("title after a rename", () => title());
show("bound again to another object", () => rebound());
show("call with another this", () => title.call(new Account()));
show("scaled", () => scaled(2, 3));
show("scaledThree", () => scaledThree(3));
show("partial", () => partial(2, 3));
show("twicePartial", () => twicePartial(3));
show("as a parameter", () => run2(add));
show("as a parameter", () => run2(scaled));
show("as a parameter", () => run0(title));
show("an unbound method as a parameter", () => run0(account.title));

const all: [string, Function][] = [
  ["add", add],
  ["addFive", addFive],
  ["addFiveOne", addFiveOne],
  ["title", title],
  ["rebound", rebound],
  ["scaledThree", scaledThree],
  ["twicePartial", twicePartial],
  ["unbound", account.add],
];
for (const [label, f] of all) {
  show(label + " name", () => f.name);
  show(label + " length", () => f.length);
  show(label + " has a prototype", () => "prototype" in f);
  show(label + " own keys", () => Reflect.ownKeys(f).map(String).join());
}
show("same function twice", () => account.add.bind(account) === account.add.bind(account));
show("map with a bound method", () => [1, 2].map(addFive));
show("balance", () => account.balance);

let sum = 0;
const direct = (a: number, b: number): number => a + b;
for (let i = 0; i < 2000; i++) sum += run2(direct);
show("2000 plain functions", () => sum);
show("then a bound one", () => run2(add));
show("then a plain one", () => run2(direct));
show("a bound legacy constructor", () => typeof Legacy.bind({ made: 0 }));
