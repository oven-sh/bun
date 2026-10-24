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

class Stack extends Array<number> {
  limit: number = 3;
  top(): number {
    return this[this.length - 1];
  }
  isFull(): boolean {
    return this.length >= this.limit;
  }
  pushTwice(n: number): number {
    this.push(n);
    return this.push(n);
  }
  total(): number {
    let sum = 0;
    for (const n of this) sum += n;
    return sum;
  }
}
class Registry extends Map<string, number> {
  misses: number = 0;
  lookup(key: string): number {
    const found = this.get(key);
    if (found === undefined) {
      this.misses++;
      return -1;
    }
    return found;
  }
  count(): number {
    return this.size;
  }
  viaSuper(key: string): boolean {
    return super.has(key);
  }
}
class Failure extends Error {
  code: number = 7;
  describe(): string {
    return this.code + " " + this.message;
  }
}

const stack = new Stack();
stack.push(1, 2);
const registry = new Registry([["k", 5]]);
const failure = new Failure("failed");

show("honest top", () => stack.top());
show("honest isFull", () => stack.isFull());
show("honest total", () => stack.total());
show("bare top", () => (0, stack.top)());
show("top of a plain array", () => stack.top.call([7, 8]));
show("top of an array-like", () => stack.top.call({ length: 1, 0: 9 }));
show("top of a string", () => stack.top.call("xyz"));
show("top of a typed array", () => stack.top.call(new Uint8Array([4, 5])));
show("top of an empty array", () => stack.top.call([]));
show("isFull of a plain array", () => stack.isFull.call([1, 2, 3, 4]));
show("total of a plain array", () => stack.total.call([7, 8]));
show("total of a set", () => stack.total.call(new Set([7, 8])));
show("total of a string", () => stack.total.call("12"));
show("total of an array-like", () => stack.total.call({ length: 1, 0: 9 }));
show("pushTwice on a plain array", () => stack.pushTwice.call([1], 5));
show("pushTwice on an array-like", () => stack.pushTwice.call({ length: 0 }, 5));
show("pushTwice on an object with its own push", () => stack.pushTwice.call({ push: (n: number) => n * 100 }, 5));

show("honest lookup", () => registry.lookup("k") + " " + registry.lookup("x") + " " + registry.misses);
show("bare lookup", () => (0, registry.lookup)("k"));
show("lookup on a plain map", () => registry.lookup.call(new Map([["k", 50]]), "k"));
show("a miss on a plain map", () => {
  const plain = new Map<string, number>();
  return registry.lookup.call(plain, "k") + " " + Object.keys(plain).join() + " " + String(Reflect.get(plain, "misses"));
});
show("lookup on a look-alike", () => registry.lookup.call({ get: () => 500, misses: 0 }, "k"));
show("lookup on a set", () => registry.lookup.call(new Set(["k"]), "k"));
show("count of a plain map", () => registry.count.call(new Map([["a", 1]])));
show("count of a set", () => registry.count.call(new Set([1, 2])));
show("count of a look-alike", () => registry.count.call({ size: "big" }));
show("viaSuper on a plain map", () => registry.viaSuper.call(new Map([["k", 1]]), "k"));
show("viaSuper on a set", () => registry.viaSuper.call(new Set(["k"]), "k"));
show("viaSuper on a look-alike", () => registry.viaSuper.call({ has: () => true }, "k"));

show("honest describe", () => failure.describe());
show("describe on a plain error", () => failure.describe.call(new Error("plain")));
show("describe on a look-alike", () => failure.describe.call({ code: 1, message: "like" }));
show("bare describe", () => (0, failure.describe)());
