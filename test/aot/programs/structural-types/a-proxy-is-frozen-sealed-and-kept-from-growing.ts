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

function watched(target: Vec): Vec {
  return new Proxy(target, {
    isExtensible: inner => (log.push("isExtensible"), Reflect.isExtensible(inner)),
    preventExtensions: inner => (log.push("preventExtensions"), Reflect.preventExtensions(inner)),
    defineProperty: (inner, key, descriptor) => (log.push("define:" + String(key)), Reflect.defineProperty(inner, key, descriptor)),
    getOwnPropertyDescriptor: (inner, key) => (log.push("describe:" + String(key)), Reflect.getOwnPropertyDescriptor(inner, key)),
    ownKeys: inner => (log.push("ownKeys"), Reflect.ownKeys(inner)),
    set: (inner, key, value, receiver) => (log.push("set:" + String(key)), Reflect.set(inner, key, value, receiver)),
  });
}

function setX(v: Vec): number {
  v.x = 9;
  return v.x;
}

function grow(v: Vec & { extra?: number }): number | undefined {
  v.extra = 1;
  return v.extra;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += setX(new Vec(i, 1)) + (grow(new Vec(i, 1)) ?? 0);
console.log("after 2000 honest vectors", warm);

logged("a store", () => setX(watched(new Vec(3, 4))));
logged("a new member", () => grow(watched(new Vec(3, 4))));
logged("freeze", () => Object.isFrozen(Object.freeze(watched(new Vec(3, 4)))));
logged("seal", () => Object.isSealed(Object.seal(watched(new Vec(3, 4)))));
logged("preventExtensions", () => Object.isExtensible(Object.preventExtensions(watched(new Vec(3, 4)))));
logged("a store after freeze", () => setX(Object.freeze(watched(new Vec(3, 4)))));
logged("a store after seal", () => setX(Object.seal(watched(new Vec(3, 4)))));
logged("a new member after preventExtensions", () => grow(Object.preventExtensions(watched(new Vec(3, 4)))));
logged("the target is frozen through the proxy", () => {
  const target = new Vec(3, 4);
  Object.freeze(watched(target));
  return [Object.isFrozen(target), (() => { try { return setX(target); } catch { return "threw"; } })()];
});
logged("the target is frozen behind the proxy's back", () => {
  const target = new Vec(3, 4);
  const proxy = watched(target);
  const before = setX(proxy);
  Object.freeze(target);
  return [before, (() => { try { return setX(proxy); } catch { return "threw"; } })(), proxy.x];
});
logged("a proxy that refuses to stop growing", () => Object.preventExtensions(new Proxy(new Vec(3, 4), { preventExtensions: () => false })));
logged("a proxy that only says that it stopped growing", () => Object.preventExtensions(new Proxy(new Vec(3, 4), { preventExtensions: () => true })));
logged("a proxy that lies about growing", () => Object.isExtensible(new Proxy(new Vec(3, 4), { isExtensible: () => false })));
logged("a proxy that refuses definitions", () => Object.defineProperty(new Proxy(new Vec(3, 4), { defineProperty: () => false }), "x", { value: 1 }));
logged("a store through a proxy that refuses definitions", () => setX(new Proxy(new Vec(3, 4), { defineProperty: () => (log.push("define"), false) })));
logged("honest again", () => [setX(new Vec(3, 4)), grow(new Vec(3, 4))]);
