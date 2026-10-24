function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

interface Options {
  size?: number;
  label?: string;
  inner?: { n: number };
}

function sizeIfThere(o: Options): number {
  return "size" in o ? o.size + 1 : -1;
}

function labelIfOwn(o: Options): number {
  if (Object.hasOwn(o, "label") && "label" in o) return o.label.length;
  return -1;
}

function innerIfThere(o: Options): number {
  return "inner" in o ? o.inner.n : -1;
}

function sizeOrDefault(o: Options): number {
  return (o.size ?? 10) + 1;
}

function merged(a: Options, b: Options): Options {
  return { ...a, ...b };
}

function described(o: Options): string {
  return Object.keys(o).join() + "|" + JSON.stringify(o) + "|" + ("size" in o);
}

attempt("honest", () => [sizeIfThere({ size: 1 }), sizeIfThere({}), labelIfOwn({ label: "ab" }), labelIfOwn({}), innerIfThere({ inner: { n: 5 } }), innerIfThere({}), sizeOrDefault({}), sizeOrDefault({ size: 1 }), described(merged({ size: 1 }, { label: "l" }))]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sizeIfThere(i & 1 ? { size: i } : {}) + labelIfOwn({ label: "ab" }) + innerIfThere({ inner: { n: i } }) + sizeOrDefault({});
console.log("2000 honest rounds", warm);

function withUndefined(): Options {
  const o: Options = {};
  Object.assign(o, { size: undefined, label: undefined, inner: undefined });
  return o;
}

function definedAsUndefined(): Options {
  const o: Options = {};
  Object.defineProperty(o, "size", { value: undefined, enumerable: true, writable: true, configurable: true });
  return o;
}

function fromEntries(): Options {
  const o: Options = { size: 1, label: "l", inner: { n: 1 } };
  for (const key of Object.keys(o)) Reflect.set(o, key, undefined);
  return o;
}

function inherited(): Options {
  class Base {
    size = 7;
  }
  class Derived extends Base {}
  return new Derived();
}

function onThePrototype(): Options {
  class WithGetter {
    get size(): number {
      log.push("get-size");
      return 8;
    }
  }
  return new WithGetter();
}

for (const [name, make] of [["assigned undefined", withUndefined], ["defined as undefined", definedAsUndefined], ["set to undefined by Reflect.set", fromEntries], ["a field of a base class", inherited], ["a getter of the prototype", onThePrototype]] satisfies [string, () => Options][]) {
  attempt(name + ": sizeIfThere", () => sizeIfThere(make()));
  attempt(name + ": labelIfOwn", () => labelIfOwn(make()));
  attempt(name + ": innerIfThere", () => innerIfThere(make()));
  attempt(name + ": sizeOrDefault", () => sizeOrDefault(make()));
  attempt(name + ": described", () => described(make()));
  attempt(name + ": merged over a full one", () => described(merged({ size: 1, label: "l" }, make())));
  attempt(name + ": merged, then read", () => sizeIfThere(merged({ size: 1 }, make())));
}

attempt("deleted after the test", () => {
  const o: Options = { size: 1 };
  const drop = () => {
    delete o.size;
  };
  if ("size" in o) {
    drop();
    return o.size + 1;
  }
  return -1;
});
attempt("a type that allows undefined beside one that does not", () => {
  const loose: { size?: number | undefined } = { size: undefined };
  const read = (o: { size?: number | undefined }): string => ("size" in o ? "there " + o.size : "absent");
  return [read(loose), read({}), read({ size: 1 })];
});
attempt("honest again", () => [sizeIfThere({ size: 1 }), sizeIfThere({}), labelIfOwn({ label: "ab" }), innerIfThere({}), sizeOrDefault({})]);
