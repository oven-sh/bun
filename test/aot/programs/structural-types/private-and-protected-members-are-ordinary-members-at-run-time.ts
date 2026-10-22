class Wallet {
  private cash = 5;
  protected limit = 100;
  owner = "wallet";
  spend(amount: number): number {
    this.cash -= amount;
    return this.cash;
  }
  richerThan(other: Wallet): boolean {
    return this.cash > other.cash;
  }
  room(): number {
    return this.limit - this.cash;
  }
}

class Purse extends Wallet {
  protected limit = 50;
  owner = "purse";
  roomOf(other: Purse): number {
    return other.limit;
  }
}

type Public = Pick<Wallet, keyof Wallet>;

class Imitation {
  owner = "imitation";
  spend(amount: number): number {
    return -amount;
  }
  richerThan(): boolean {
    return true;
  }
  room(): number {
    return -1;
  }
}

function listing(value: object): string {
  return Object.keys(value).join() + " " + JSON.stringify(value) + " " + JSON.stringify({ ...value });
}

function use(w: Public): string {
  return w.owner + " " + w.spend(1) + " " + w.room() + " " + w.richerThan(new Wallet()) + " " + (w instanceof Wallet);
}

function nominal(w: Wallet): string {
  return w.owner + " " + w.spend(1) + " " + w.room() + " " + w.richerThan(new Wallet()) + " " + (w instanceof Wallet);
}

console.log("a wallet lists its private members: " + listing(new Wallet()));
console.log("a purse: " + listing(new Purse()));
console.log("the public side, a wallet: " + use(new Wallet()));
console.log("the public side, a purse: " + use(new Purse()));
console.log("the public side, an imitation: " + use(new Imitation()));
console.log("the class type, a wallet: " + nominal(new Wallet()));
console.log("the class type, a purse: " + nominal(new Purse()));

const proxied: Wallet = new Proxy(new Wallet(), {
  get(target, key, receiver) {
    return key === "cash" ? 1000 : Reflect.get(target, key, receiver);
  },
});
console.log("the class type, a proxy: " + nominal(proxied));
console.log("a wallet against the proxy: " + new Wallet().richerThan(proxied));

const bare: Wallet = Object.create(Wallet.prototype);
console.log("the class type, only the prototype: " + nominal(bare));
console.log("what it holds afterwards: " + listing(bare));

const cloned: Wallet = Object.assign(Object.create(Wallet.prototype), { owner: "copy", cash: 7 });
console.log("the class type, some members: " + nominal(cloned));

const everyone: Public[] = [new Wallet(), new Imitation(), new Purse(), proxied, bare];
console.log("owners: " + everyone.map(w => w.owner).join());
console.log("spent: " + everyone.map(w => w.spend(2)).join());
console.log("instances: " + everyone.map(w => w instanceof Wallet).join());

let total = 0;
const spendOne = (w: Public) => w.spend(1);
const honest = new Wallet();
for (let i = 0; i < 2000; i++) total += spendOne(honest);
console.log("2000 honest: " + total);
console.log("then the imitation: " + spendOne(new Imitation()));

const purse = new Purse();
console.log("protected through a sibling: " + purse.roomOf(new Purse()) + " " + purse.room());
console.log("by name at run time: " + Object.entries(purse).map(([key, value]) => key + "=" + value).join());

export {};
