interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function watched(target: Point): Point {
  return new Proxy(target, {
    get(t, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(t, key, receiver);
    },
    set(t, key, value, receiver) {
      log.push("set " + String(key) + "=" + String(value));
      return Reflect.set(t, key, value, receiver);
    },
    has(t, key) {
      log.push("has " + String(key));
      return Reflect.has(t, key);
    },
    ownKeys(t) {
      log.push("ownKeys");
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, key) {
      log.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
    defineProperty(t, key, descriptor) {
      log.push("define " + String(key));
      return Reflect.defineProperty(t, key, descriptor);
    },
    deleteProperty(t, key) {
      log.push("delete " + String(key));
      return Reflect.deleteProperty(t, key);
    },
    getPrototypeOf(t) {
      log.push("getPrototypeOf");
      return Reflect.getPrototypeOf(t);
    },
  });
}

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function reversedSum(p: Point): number {
  return p.y - p.x;
}

function move(p: Point): void {
  p.x += 1;
  p.y = p.x;
}

class Holder {
  constructor(public point: Point) {}
  sum(): number {
    return this.point.x + this.point.y;
  }
}

class Pair {
  x = 7;
  y = 8;
  total(): number {
    return this.x + this.y;
  }
}

const p = watched({ x: 1, y: 2 });
flush("x then y", sum(p));
flush("y then x", reversedSum(p));
flush("stores", move(p));
flush("field", new Holder(p).sum());
flush("in", "x" in p);
flush("hasOwn", Object.hasOwn(p, "x"));
flush("keys", Object.keys(p).join());
flush("entries", Object.entries(p).join("|"));
flush("json", JSON.stringify(p));
flush("spread", JSON.stringify({ ...p }));
flush("rest pattern", JSON.stringify((({ x, ...rest }: Point) => rest)(p)));
flush("for-in", (() => {
  let keys = "";
  for (const key in p) keys += key;
  return keys;
})());
flush("assign from", JSON.stringify(Object.assign({}, p)));
flush("assign to", JSON.stringify(Object.assign(p, { x: 5 })));
flush("pattern", (({ y, x }: Point) => y * 10 + x)(p));
flush("instanceof", p instanceof Object);
flush("typeof", typeof p);

const plain: Point = { x: 1, y: 2 };
let total = 0;
for (let i = 0; i < 2000; i++) total += sum(plain);
flush("2000 honest", total);
flush("then the proxy", sum(p));
flush("then plain", sum(plain));

const list: Point[] = [plain, p, plain];
flush("elements", list.map(sum).join());

const instance: Pair = new Proxy(new Pair(), {
  get(t, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(t, key, receiver);
  },
});
flush("a method through a proxy of an instance", instance.total());
flush("instanceof its class", instance instanceof Pair);

const inventing: Point = new Proxy({ x: 0, y: 0 }, { get: (_, key) => (key === "x" ? 40 : 2) });
flush("a proxy that invents its values", sum(inventing));

const { proxy: revocable, revoke } = Proxy.revocable({ x: 1, y: 1 }, {});
const soonGone: Point = revocable;
flush("before revoking", sum(soonGone));
revoke();
try {
  flush("after revoking", sum(soonGone));
} catch (error) {
  flush("after revoking", "threw " + (error instanceof Error ? error.constructor.name : typeof error));
}

export {};
