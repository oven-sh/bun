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

const log: string[] = [];

class Gauge {
  level = 5;
  get doubled(): number {
    log.push("prototype getter");
    return this.level * 2;
  }
}

class WithCallback {
  value = 1;
  onChange: () => void = () => {};
}

class WithSymbol {
  value = 1;
  mark = Symbol("mark");
}

class WithSymbolKey {
  value = 1;
  [Symbol.toStringTag] = "Custom";
}

function nameOf(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.name : typeof error) + " " + (error instanceof DOMException);
  }
}

console.log("a function in a field -> " + nameOf(() => structuredClone(new WithCallback())));
console.log("a symbol in a field -> " + nameOf(() => structuredClone(new WithSymbol())));
console.log("a function itself -> " + nameOf(() => structuredClone(nameOf)));
console.log("a class itself -> " + nameOf(() => structuredClone(Gauge)));
console.log("a symbol itself -> " + nameOf(() => structuredClone(Symbol.iterator)));
console.log("a weak map -> " + nameOf(() => structuredClone(new WeakMap())));
console.log("a promise -> " + nameOf(() => structuredClone(Promise.resolve(1))));
console.log("a proxy of an instance -> " + nameOf(() => structuredClone(new Proxy(new Gauge(), {}))));
console.log("a generator -> " + nameOf(() => structuredClone((function* () {})())));
console.log("a key that is a symbol is left out -> " + nameOf(() => {
  const clone = structuredClone(new WithSymbolKey());
  return [clone.value, clone[Symbol.toStringTag], Reflect.ownKeys(clone).length];
}));

attempt("a getter of the prototype is not copied", () => {
  const clone = structuredClone(new Gauge());
  return [clone.level, clone.doubled, typeof clone.doubled, Object.keys(clone), log.length];
});
attempt("an own getter is evaluated once", () => {
  log.length = 0;
  const source: { readonly level: number } = {
    get level() {
      log.push("own getter");
      return 5;
    },
  };
  const clone = structuredClone(source);
  return [clone.level, clone.level, log, Object.getOwnPropertyDescriptor(clone, "level")?.writable];
});
attempt("an own getter that throws", () =>
  structuredClone({
    get level(): number {
      throw new RangeError("no level");
    },
  }),
);
attempt("members that are not enumerable are left out", () => {
  const source = Object.defineProperty(new Gauge(), "level", { enumerable: false });
  const clone = structuredClone(source);
  return [clone.level, Object.keys(clone)];
});
attempt("a frozen instance gives a clone that is not frozen", () => {
  const frozen: Gauge = Object.freeze(new Gauge());
  const clone = structuredClone(frozen);
  clone.level = 6;
  return [clone.level, Object.isFrozen(clone)];
});
attempt("wrapper objects", () => {
  const clone = structuredClone({ n: new Number(5), s: new String("ab"), b: new Boolean(false) });
  return [typeof clone.n, clone.n.valueOf(), clone.s.length, clone.b.valueOf(), clone.n instanceof Number];
});
attempt("primitives come back as they are", () => [structuredClone(5), structuredClone(-0), structuredClone("text"), structuredClone(null), structuredClone(undefined), structuredClone(5n)]);
attempt("a transferred buffer leaves the source empty", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const clone = structuredClone(bytes, { transfer: [bytes.buffer] });
  return [clone.length, bytes.length, bytes.byteLength, bytes[0]];
});
attempt("an object without a prototype", () => {
  const source: { a: number } = Object.assign(Object.create(null), { a: 1 });
  const clone = structuredClone(source);
  return [clone.a, Object.getPrototypeOf(clone) === Object.prototype];
});
