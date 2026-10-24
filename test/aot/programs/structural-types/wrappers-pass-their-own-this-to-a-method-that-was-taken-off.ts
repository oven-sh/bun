function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

function passing<A extends unknown[], R>(f: (...args: A) => R): (...args: A) => R {
  return function (this: unknown, ...args: A): R {
    return f.apply(this, args);
  };
}
function dropping<A extends unknown[], R>(f: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => f(...args);
}
function once<R>(f: () => R): () => R | undefined {
  let ran = false;
  return function (this: unknown): R | undefined {
    if (ran) return undefined;
    ran = true;
    return f.call(this);
  };
}
function counted<R>(f: () => R): { (): R; calls: number } {
  const wrapper = Object.assign(
    function (this: unknown): R {
      wrapper.calls++;
      return f.call(this);
    },
    { calls: 0 },
  );
  return wrapper;
}

class Account {
  balance: number = 100;
  owner: string = "ann";
  read(): number {
    return this.balance;
  }
  add(amount: number, bonus: number): number {
    this.balance += amount + bonus;
    return this.balance;
  }
  title(): string {
    return this.owner.toUpperCase();
  }
  wrappedRead = passing(this.read);
  droppedRead = dropping(this.read);
}

const account = new Account();
show("honest", () => account.read());
show("a passing wrapper as a member", () => account.wrappedRead());
show("a dropping wrapper as a member", () => account.droppedRead());
show("a passing wrapper, bare", () => (0, account.wrappedRead)());
show("a passing wrapper on a look-alike", () => account.wrappedRead.call({ balance: 5 }));

const holder = {
  balance: 7,
  owner: "holder",
  read: passing(account.read),
  add: passing(account.add),
  title: passing(account.title),
  readOnce: once(account.read),
  readCounted: counted(account.read),
};
show("on another object: read", () => holder.read());
show("on another object: add", () => holder.add(1, 2));
show("on another object: title", () => holder.title());
show("on another object: once", () => holder.readOnce());
show("on another object: once again", () => holder.readOnce());
show("on another object: counted", () => holder.readCounted() + " " + holder.readCounted() + " " + holder.readCounted.calls);
show("the account is untouched", () => account.balance);
show("the other object", () => holder.balance);

const wrong = { balance: "much", owner: 5, read: passing(account.read), add: passing(account.add), title: passing(account.title) };
show("other kinds: read", () => wrong.read());
show("other kinds: add", () => wrong.add(1, 2));
show("other kinds: title", () => wrong.title());

show("two wrappers deep", () => ({ balance: 9, read: passing(passing(account.read)) }).read());
show("a wrapper around a bound method", () => ({ balance: 9, read: passing(account.read.bind(account)) }).read());
show("a wrapper handed to map", () => [0].map(passing(account.read))[0]);
show("a wrapper handed to map with a this", () => [0].map(passing(account.read), { balance: 11 })[0]);

let total = 0;
for (let i = 0; i < 2000; i++) total += account.wrappedRead();
show("2000 honest calls through the wrapper", () => total);
show("then on another object", () => holder.read());
