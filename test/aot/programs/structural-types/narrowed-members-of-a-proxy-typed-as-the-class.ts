function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Holder {
  shape: Shape = new Square();
  value: number | string = 1;
  leaf: Square | null = new Square();
  mode: "on" | "off" = "on";
}

const log: string[] = [];

function alternating(): Holder {
  const reads = new Map<PropertyKey, number>();
  const second: Holder = { shape: new Shape(), value: "text", leaf: null, mode: "off" };
  return new Proxy(new Holder(), {
    get(target, key, receiver) {
      const n = reads.get(key) ?? 0;
      reads.set(key, n + 1);
      log.push(String(key) + n);
      return Reflect.get(n % 2 === 0 ? target : second, key);
    },
  });
}

function transparent(): Holder {
  return new Proxy(new Holder(), {});
}

function swallowsStores(): Holder {
  return new Proxy(new Holder(), {
    set() {
      return true;
    },
  });
}

const uses: [string, (h: Holder) => unknown][] = [
  ["instanceof", h => (h.shape instanceof Square ? h.shape.edge : "other")],
  ["instanceof, doubled", h => (h.shape instanceof Square ? h.shape.edge * 2 : "other")],
  ["typeof", h => (typeof h.value === "number" ? h.value : "other")],
  ["typeof, plus one", h => (typeof h.value === "number" ? h.value + 1 : "other")],
  ["not null", h => (h.leaf !== null ? h.leaf : "other")],
  ["not null, a member", h => (h.leaf !== null ? h.leaf.edge : "other")],
  ["a literal", h => (h.mode === "on" ? h.mode : "other")],
  ["a store narrows, then a read", h => {
    h.value = "stored";
    return [h.value, h.value.length];
  }],
  ["a store of a number narrows, then arithmetic", h => {
    h.value = 41;
    return h.value + 1;
  }],
  ["a store of null narrows", h => {
    h.leaf = null;
    return h.leaf;
  }],
];

for (const [name, use] of uses) attempt("a plain holder: " + name, () => use(new Holder()));
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Holder());
for (const [name, use] of uses) attempt("a proxy without traps: " + name, () => use(transparent()));
for (const [name, use] of uses) attempt("a proxy that alternates: " + name, () => use(alternating()));
console.log("reads: " + log.join(" "));
for (const [name, use] of uses) attempt("a proxy that swallows stores: " + name, () => use(swallowsStores()));
for (const [name, use] of uses) attempt("a plain holder again: " + name, () => use(new Holder()));
