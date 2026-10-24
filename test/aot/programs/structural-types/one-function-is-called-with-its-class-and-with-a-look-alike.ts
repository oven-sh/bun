class Account {
  balance = 10;
  owner = "account";
  deposit(amount: number): number {
    this.balance += amount;
    return this.balance;
  }
  describe(): string {
    return this.owner + ":" + this.balance;
  }
}

class Sink {
  owner = "sink";
  swallowed = 0;
  balance = 0;
  deposit(amount: number): number {
    this.swallowed += amount;
    return -1;
  }
  describe(): string {
    return this.owner + ":" + this.balance + ":" + this.swallowed;
  }
}

function pay(account: Account, amount: number): string {
  const result = account.deposit(amount);
  return result + " " + account.describe() + " " + account.balance + " " + (account instanceof Account);
}

function honestOne(): string {
  return pay(new Account(), 1);
}

function honestTwo(): string {
  const account = new Account();
  pay(account, 2);
  return pay(account, 3);
}

function honestMany(): number {
  const account = new Account();
  for (let i = 0; i < 2000; i++) pay(account, 1);
  return account.balance;
}

function oddPlain(): string {
  return pay(new Sink(), 4);
}

const handlers: { pay: (account: Account, amount: number) => string } = { pay };
const key: "pay" | "none" = handlers.pay.length === 2 ? "pay" : "none";

class Teller {
  action = pay;
  serve(account: Account): string {
    return this.action(account, 5);
  }
}

console.log("look-alike first: " + oddPlain());
console.log("honest one: " + honestOne());
console.log("honest two: " + honestTwo());
console.log("honest many: " + honestMany());
console.log("look-alike, plain call: " + oddPlain());
console.log("look-alike, call: " + pay.call(undefined, new Sink(), 6));
console.log("look-alike, apply: " + pay.apply(undefined, [new Sink(), 7]));
console.log("look-alike, bind: " + pay.bind(undefined, new Sink())(8));
console.log("look-alike, Reflect.apply: " + Reflect.apply(pay, undefined, [new Sink(), 9]));
console.log("look-alike, computed name: " + (key === "pay" ? handlers[key](new Sink(), 10) : "none"));
console.log("look-alike, a field: " + new Teller().serve(new Sink()));
console.log("honest, a field: " + new Teller().serve(new Account()));

const mixed: Account[] = [new Account(), new Sink(), new Account(), new Sink()];
console.log("forEach:");
mixed.forEach((account, index) => console.log("  " + pay(account, index)));
console.log("map with the function itself: " + mixed.map(pay).join(" | "));
console.log("reduce: " + mixed.reduce((total, account) => total + account.deposit(1), 0));
console.log("sort: " + mixed.sort((a, b) => a.balance - b.balance).map(a => a.describe()).join());

console.log("a promise reaction: " + (await Promise.resolve(new Sink()).then(sink => pay(sink, 11))));
console.log("honest at the end: " + honestOne());

export {};
