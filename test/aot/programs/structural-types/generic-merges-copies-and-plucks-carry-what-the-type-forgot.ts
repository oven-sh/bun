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
  size: number;
  label: string;
}

function merge<T>(a: T, b: Partial<T>): T {
  return { ...a, ...b };
}

function assign<T extends object>(a: T, b: Partial<T>): T {
  return Object.assign(a, b);
}

function pluck<T, K extends keyof T>(list: T[], key: K): T[K][] {
  return list.map(item => item[key]);
}

function clone<T>(o: T): T {
  return structuredClone(o);
}

function entries<T extends object>(o: T): string {
  return Object.entries(o)
    .map(([k, v]) => k + "=" + show(v))
    .join();
}

function width(o: Options): number {
  return o.size + o.label.length;
}

attempt("honest", () => [width(merge({ size: 1, label: "ab" }, { size: 2 })), width(assign({ size: 1, label: "ab" }, { label: "abc" })), pluck([{ n: 1 }, { n: 2 }], "n"), entries({ a: 1 })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += width(merge({ size: i, label: "ab" }, { size: 1 })) + width(assign({ size: i, label: "ab" }, {})) + pluck([{ n: i }], "n")[0];
console.log("2000 honest rounds", warm);

attempt("merge with an explicit undefined", () => {
  const merged = merge<Options>({ size: 1, label: "ab" }, { size: undefined });
  return [merged.size, merged.size + 1, Object.keys(merged), "size" in merged];
});
attempt("merge with an explicit undefined: a method", () => width(merge<Options>({ size: 1, label: "ab" }, { label: undefined })));
attempt("assign with an explicit undefined", () => {
  const target: Options = { size: 1, label: "ab" };
  assign(target, { size: undefined });
  return [target.size, target.size + 1];
});
attempt("merge carries members the type forgot", () => {
  const wide = { size: "wide", extra: true };
  const forgotten: { extra: boolean } = wide;
  const base: { size: number; extra: boolean } = { size: 1, extra: false };
  const merged = merge(base, forgotten);
  return [merged.size, merged.size + 1, entries(merged)];
});
attempt("merge of class instances loses the prototype", () => {
  class Dog {
    legs = 4;
    bark(): number {
      return this.legs * 2;
    }
  }
  const merged = merge(new Dog(), { legs: 3 });
  return [merged.legs, merged instanceof Dog, typeof merged.bark];
});
attempt("merge of class instances, then a method", () => {
  class Dog {
    legs = 4;
    bark(): number {
      return this.legs * 2;
    }
  }
  return merge(new Dog(), {}).bark();
});
attempt("clone of a class instance", () => {
  class Dog {
    legs = 4;
    bark(): number {
      return this.legs * 2;
    }
  }
  const copy = clone(new Dog());
  return [copy.legs, copy instanceof Dog, typeof copy.bark];
});
attempt("clone of a class instance, then a method", () => {
  class Dog {
    legs = 4;
    bark(): number {
      return this.legs * 2;
    }
  }
  return clone(new Dog()).bark();
});
attempt("merge runs getters once and keeps values", () => {
  let reads = 0;
  const source = {
    get size(): number {
      return ++reads;
    },
    label: "l",
  };
  const merged = merge<Options>(source, {});
  return [merged.size, merged.size, source.size, reads];
});
attempt("pluck over shapes that differ", () => {
  const wider = { extra: 1, n: 2 };
  const withGetter = {
    get n(): number {
      log.push("get-n");
      return 3;
    },
  };
  const list: { n: number }[] = [{ n: 1 }, wider, withGetter];
  return pluck(list, "n").map(n => n + 1);
});
attempt("pluck a method", () => pluck(["a", "bc"], "length"));
attempt("entries list what the type forgot", () => {
  const wide = { a: 1, b: "two" };
  const narrow: { a: number } = wide;
  return entries(narrow);
});
attempt("values typed by the narrow type", () => {
  const wide = { a: 1, b: "two" };
  const narrow: { a: number } = wide;
  const record: Record<string, number> = narrow;
  return Object.values(record).map(v => v + 1);
});
