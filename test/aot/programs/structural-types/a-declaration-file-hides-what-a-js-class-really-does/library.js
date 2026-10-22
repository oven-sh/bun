export class Account {
  constructor(balance) {
    let held = balance;
    Object.defineProperty(this, "balance", {
      get() {
        Account.reads++;
        return Account.reads % 3 === 0 ? String(held) : held;
      },
      set(value) {
        held = value * 2;
      },
      enumerable: true,
      configurable: true,
    });
  }
  deposit(amount) {
    this.balance = this.balance + amount;
    return this;
  }
  static reads = 0;
}

export class Frozen {
  constructor() {
    this.size = 1;
    Object.freeze(this);
  }
}

export class Lazy {
  get items() {
    delete Lazy.prototype.items;
    return undefined;
  }
}

export function makeList() {
  class Odd extends Array {
    push() {
      return 42;
    }
    get length() {
      return super.length;
    }
    map() {
      return "mapped";
    }
  }
  return Odd.from([1, 2, 3]);
}

export function makeMap() {
  return new (class extends Map {
    get(key) {
      return String(super.get(key));
    }
  })([["a", 1]]);
}

export function makePromise() {
  return { then(resolve) { resolve("not a number"); } };
}
