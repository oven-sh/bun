function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Account {
  balance = 10;
  history: number[] = [];
  deposit(amount: number): number {
    this.balance += amount;
    this.history.push(amount);
    return this.balance;
  }
}

function Audited(Base: new () => Account) {
  return class extends Base {
    audits = 0;
    deposit(amount: number): number {
      this.audits++;
      return super.deposit(amount * 2);
    }
  };
}

function pay(a: Account, amount: number): number {
  return a.deposit(amount) + a.balance;
}

function total(accounts: Account[]): number {
  let sum = 0;
  for (const a of accounts) sum += a.balance + a.history.length;
  return sum;
}

const plain = new Account();
const audited = new (Audited(Account))();
const twice = new (Audited(Audited(Account)))();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += pay(new Account(), 1);
console.log("2000 honest rounds: " + warm);
console.log("pay: " + pay(plain, 1) + " " + pay(audited, 1) + " " + pay(twice, 1));
console.log("total: " + total([plain, audited, twice]));
console.log(describe(plain) + " | " + describe(audited) + " | " + describe(twice));
