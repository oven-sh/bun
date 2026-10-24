function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + value;
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Account {
  balance: number = 100;
  owner: string = "ann";
  history: number[] = [1, 2, 3];
  limit?: number;
  total(): number {
    return this.balance + this.history.length;
  }
}

function* audit(account: Account): Generator<string, string, void> {
  const whole: number = 7;
  const real: number = 0.5;
  const name: string = account.owner;
  const flag: boolean = true;
  const big: bigint = 12345678901234567890n;
  const balance: number = account.balance;
  const history: number[] = account.history;
  const length: number = history.length;
  const pair: [number, string] = [account.balance, account.owner];
  const { balance: copied, owner } = account;
  const read = (): number => account.balance;
  yield "ready";
  const lines: string[] = [];
  lines.push("whole " + text(whole) + " real " + text(real) + " flag " + text(flag) + " big " + text(big));
  lines.push("name " + text(name) + " owner " + text(owner) + " now " + text(account.owner));
  lines.push("balance " + text(balance) + " copied " + text(copied) + " now " + text(account.balance) + " through a closure " + text(read()));
  lines.push("length " + text(length) + " now " + text(history.length) + " same list " + (history === account.history));
  lines.push("pair " + text(pair));
  lines.push("limit " + text(account.limit));
  lines.push("keys " + Object.keys(account).join());
  try {
    lines.push("total " + text(account.total()));
  } catch (error) {
    lines.push("total " + failure(error));
  }
  let sum = 0;
  for (let i = 0; i < length; i++) sum += history[i];
  lines.push("sum over the old length " + text(sum));
  return lines.join("\n  ");
}

const changes: [string, (account: Account) => void][] = [
  ["nothing", () => {}],
  ["stores of the same kinds", account => {
    account.balance = -5;
    account.owner = "bob";
  }],
  ["a fraction where a whole number was", account => {
    account.balance = 0.25;
  }],
  ["the list shrinks", account => {
    account.history.length = 1;
  }],
  ["the list grows", account => {
    account.history.push(4, 5);
  }],
  ["the list is replaced", account => {
    account.history = [9];
  }],
  ["the list gets a hole", account => {
    delete account.history[1];
  }],
  ["an optional member appears", account => {
    account.limit = 3;
  }],
  ["a getter is defined over a field", account => {
    Object.defineProperty(account, "balance", { get: () => 1e21, enumerable: true, configurable: true });
  }],
  ["an own method hides the class's", account => {
    account.total = () => -1;
  }],
  ["the prototype is taken away", account => {
    Object.setPrototypeOf(account, null);
  }],
  ["frozen", account => {
    Object.freeze(account);
  }],
];

for (const [label, change] of changes) {
  const account = new Account();
  const g = audit(account);
  g.next();
  change(account);
  console.log(label + ":\n  " + g.next().value);
}

function* manyLocals(): Generator<number, number, number> {
  let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8;
  let p = 0.5, q = 1.5, r = 2.5, s = 3.5;
  for (let i = 0; i < 3; i++) {
    const sent: number = yield a + b + c + d + e + f + g + h + p + q + r + s;
    a += sent; c += sent; e += sent; g += sent;
    p *= sent; r *= sent;
    [b, d] = [d, b];
    [q, s] = [s, q];
  }
  return a * 1000 + b * 100 + c * 10 + d + e + f + g + h + p + q + r + s;
}

const many = manyLocals();
console.log(text(many.next(0)) + " " + text(many.next(1)) + " " + text(many.next(2)) + " " + text(many.next(3)));
