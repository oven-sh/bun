// Methods of classes written in TypeScript are called by name where the type of the receiver says nothing. They are asked of the run time once for each class, and what was learnt ends when a method is replaced.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
declare const aotOperationCount: undefined | ((name: string) => number);
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
class Account {
  balance: number;
  owner: string;
  constructor(owner: string, balance: number) { this.owner = owner; this.balance = balance; }
  deposit(amount: number): number { this.balance += amount; return this.balance; }
  label(): string { return this.owner + ":" + this.balance; }
  fee(): number { return 1; }
  close(): void { this.balance = 0; }
}
class Savings extends Account {
  rate: number = 2;
  fee(): number { return 0; }
  grow(): number { return this.deposit(this.rate); }
}
class Fixed extends Savings {
  term: number = 12;
}
function fees(account: any, turns: number): number { let sum = 0; for (let i = 0; i < turns; i++) sum += account.fee(); return sum; }
function labels(account: any, turns: number): string { let text = ""; for (let i = 0; i < turns; i++) text = account.label(); return text; }
function grows(account: any, turns: number): number { let last = 0; for (let i = 0; i < turns; i++) last = account.grow(); return last; }
const asked = () => count("operationAOTGetByIdAndCache");
const accounts: any[] = [new Account("a", 1), new Savings("s", 2), new Fixed("f", 3)];
let most = 0;
const results: unknown[] = [];
for (const call of [fees, labels]) {
  for (const account of accounts) {
    const before = asked();
    results.push(call(account, 500));
    most = Math.max(most, asked() - before);
  }
}
console.log(results.join());
console.log(most <= 3 ? "no method was asked of the run time more than three times" : "the run time was asked " + most + " times for one method of one class");
console.log(grows(accounts[1], 100), grows(accounts[2], 100), labels(accounts[2], 3));
console.log(accounts[0].fee === Account.prototype.fee, accounts[2].fee === Savings.prototype.fee, accounts[2].label === accounts[0].label);
Savings.prototype.fee = function (): number { return 5; };
console.log(fees(accounts[0], 10), fees(accounts[1], 10), fees(accounts[2], 10));
Account.prototype.label = function (this: Account): string { return "<" + this.owner + ">"; };
console.log(labels(accounts[0], 10), labels(accounts[1], 10), labels(accounts[2], 10));
const plain: any = { fee() { return 9; }, label() { return "plain"; } };
console.log(fees(plain, 10), labels(plain, 10), fees(accounts[2], 10), labels(new Fixed("g", 4), 10));
