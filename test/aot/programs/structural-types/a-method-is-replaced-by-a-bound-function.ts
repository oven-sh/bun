class Account {
  owner: string;
  balance: number;
  constructor(owner: string, balance: number) {
    this.owner = owner;
    this.balance = balance;
  }
  report(prefix: string): string {
    return prefix + " " + this.owner + " " + this.balance;
  }
  add(a: number, b: number): number {
    return this.balance + a + b;
  }
}

function reportOf(a: Account): string {
  return a.report(">");
}

function addOf(a: Account): number {
  return a.add(1, 2);
}

function show(label: string, a: Account): void {
  console.log(label + ": " + a.report("-") + " | " + reportOf(a) + " | " + a.add(1, 2) + " | " + addOf(a) + " | name " + a.report.name + " length " + a.report.length + " " + a.add.length + " prototype " + ("prototype" in a.report));
}

const ann = new Account("ann", 10);
const bob = new Account("bob", 20);
const original = Account.prototype.report;
const originalAdd = Account.prototype.add;

let warm = 0;
for (let i = 0; i < 2000; i++) warm += reportOf(ann).length + addOf(ann) + reportOf(bob).length;
console.log("2000 honest: " + warm);
show("before", ann);

ann.report = ann.report.bind(bob);
ann.add = ann.add.bind(bob, 100);
show("own, bound to another account", ann);
show("the other", bob);

ann.report = ann.report.bind(ann);
show("bound twice", ann);

Reflect.deleteProperty(ann, "report");
Reflect.deleteProperty(ann, "add");
show("uncovered", ann);

Account.prototype.report = original.bind(bob);
Account.prototype.add = originalAdd.bind(bob, 100, 200);
show("the prototype's, bound", ann);
show("a new one", new Account("new", 0));

Account.prototype.report = original.bind(bob, "fixed");
show("with its argument fixed", ann);

Account.prototype.report = original;
Account.prototype.add = originalAdd;
show("put back", ann);

const taken = ann.report.bind(ann);
const list: ((prefix: string) => string)[] = [taken, bob.report.bind(bob), original.bind(new Account("temp", 1))];
console.log("bound ones in a list: " + list.map(f => f("*")).join(" | "));
ann.owner = "ann2";
console.log("after a store to the owner: " + taken("*"));

export {};
