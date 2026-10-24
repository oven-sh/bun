function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Vec {
  x: number;
  y: number;
  name = "vec";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
}

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

class Account {
  balance = 10;
  history: number[] = [];
  deposit(amount: number): number {
    this.balance += amount;
    this.history.push(amount);
    return this.balance;
  }
  get doubled(): number {
    return this.balance * 2;
  }
  set doubled(value: number) {
    this.balance = value / 2;
  }
  self(): Account {
    return this;
  }
  later(): () => number {
    return () => this.balance;
  }
  static open(this: typeof Account): Account {
    return new this();
  }
}

function watched<T extends object>(target: T): T {
  return new Proxy(target, {
    get: (inner, key, receiver) => (log.push("get:" + String(key)), Reflect.get(inner, key, receiver)),
    set: (inner, key, value, receiver) => (log.push("set:" + String(key)), Reflect.set(inner, key, value, receiver)),
  });
}

function deposit(account: Account, amount: number): number {
  return account.deposit(amount);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Account();
  warm += deposit(honest, i) + honest.doubled + honest.later()() + (honest.self() === honest ? 1 : 0);
  honest.doubled = 4;
}
console.log("after 2000 honest accounts", warm);

logged("a method called on the proxy", () => deposit(watched(new Account()), 5));
logged("a method of the target called with the proxy as this", () => {
  const target = new Account();
  return [target.deposit.call(watched(target), 5), target.balance];
});
logged("a method of the proxy called with the target as this", () => {
  const target = new Account();
  return watched(target).deposit.call(target, 5);
});
logged("the getter", () => watched(new Account()).doubled);
logged("the setter", () => {
  const target = new Account();
  watched(target).doubled = 50;
  return target.balance;
});
logged("this comes back", () => {
  const target = new Account();
  const proxy = watched(target);
  return [proxy.self() === proxy, proxy.self() === target];
});
logged("this captured by an arrow function", () => watched(new Account()).later()());
logged("apply", () => Reflect.apply(Account.prototype.deposit, watched(new Account()), [5]));
logged("bind", () => Account.prototype.deposit.bind(watched(new Account()), 5)());
logged("the getter taken from its descriptor", () => Object.getOwnPropertyDescriptor(Account.prototype, "doubled")?.get?.call(watched(new Account())));
logged("Reflect.get with the proxy as the receiver", () => Reflect.get(new Account(), "doubled", watched(new Account())));
logged("Reflect.set with the proxy as the receiver", () => {
  const receiver = new Account();
  return [Reflect.set(new Account(), "doubled", 50, watched(receiver)), receiver.balance];
});
logged("a static method with a proxy of the class as this", () => watched(Account).open().balance);
logged("a vector's norm on a proxy", () => watched(new Vec(3, 4)).norm());
logged("handed to forEach as this", () => {
  const seen: number[] = [];
  [1].forEach(function (this: Account) {
    seen.push(this.balance);
  }, watched(new Account()));
  return seen;
});
