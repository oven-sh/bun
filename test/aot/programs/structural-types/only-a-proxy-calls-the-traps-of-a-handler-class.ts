const log: string[] = [];

class Handler implements ProxyHandler<{ x: number }> {
  get(target: { x: number }, key: string | symbol, receiver: unknown): unknown {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  }
  has(target: { x: number }, key: string | symbol): boolean {
    log.push("has " + String(key));
    return Reflect.has(target, key);
  }
  set(target: { x: number }, key: string | symbol, value: unknown, receiver: unknown): boolean {
    log.push("set " + String(key));
    return Reflect.set(target, key, value, receiver);
  }
  ownKeys(target: { x: number }): (string | symbol)[] {
    log.push("ownKeys");
    return Reflect.ownKeys(target);
  }
}

const p = new Proxy({ x: 1 }, new Handler());
p.x = 2;
console.log(p.x + " " + ("x" in p) + " " + Object.keys(p).join() + " [" + log.join(", ") + "]");

export {};
