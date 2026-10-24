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

const log: string[] = [];

function literal() {
  return {
    kept: 2,
    get size(): number {
      log.push("get");
      return this.kept;
    },
    set size(value: number | string) {
      log.push("set " + typeof value);
      this.kept = typeof value === "string" ? value.length : value;
    },
  };
}

class Box {
  kept = 2;
  get size(): number {
    log.push("get");
    return this.kept;
  }
  set size(value: number | string) {
    log.push("set " + typeof value);
    this.kept = typeof value === "string" ? value.length : value;
  }
}

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  [" + log.join(", ") + "]");
}

logged("a literal, destructured", () => {
  const { size, kept } = literal();
  return [size, kept];
});
logged("a class, destructured", () => {
  const { size, kept } = new Box();
  return [size, kept];
});
logged("a parameter pattern", () => (({ size }: { size: number }) => size + 1)(new Box()));
logged("a pattern with a rest", () => {
  const { kept, ...rest } = literal();
  return [kept, Object.keys(rest).join(), rest.size, Object.getOwnPropertyDescriptor(rest, "size")?.get === undefined];
});
logged("a spread of the literal takes the value", () => {
  const source = literal();
  const copy = { ...source };
  source.size = "longer";
  copy.size = 50;
  return [copy.size, copy.kept, source.size, source.kept, Object.keys(copy).join()];
});
logged("a spread of the class leaves the accessor behind", () => {
  const copy = { ...new Box() };
  return [Object.keys(copy).join(), "size" in copy];
});
logged("a spread over the accessor", () => {
  const merged = { ...literal(), size: 9 };
  return [merged.size, merged.kept];
});
logged("Object.assign into the literal runs the setter", () => {
  const target = literal();
  Object.assign(target, { size: "assigned" });
  return [target.size, target.kept];
});
logged("Object.assign into the class runs the setter", () => {
  const target = new Box();
  Object.assign(target, { size: "assigned" });
  return [target.size, target.kept, Object.keys(target).join()];
});
logged("Object.assign from the literal runs the getter", () => {
  const copy = Object.assign({}, literal());
  return [copy.size, Object.keys(copy).join(), Object.getOwnPropertyDescriptor(copy, "size")?.value];
});
logged("Object.assign from one accessor to another", () => {
  const target = new Box();
  const source = literal();
  source.size = 7;
  Object.assign(target, source);
  return [target.size, target.kept];
});
logged("the literal as JSON", () => JSON.stringify(literal()));
logged("the class as JSON", () => JSON.stringify(new Box()));
logged("entries of the literal", () => Object.entries(literal()).map(([k, v]) => k + "=" + v));
logged("values of the class", () => Object.values(new Box()));
logged("a structured clone of the literal", () => {
  const copy = structuredClone(literal());
  copy.size = "text";
  return [copy.size, copy.kept, typeof copy.size];
});
logged("for in over the literal", () => {
  const names: string[] = [];
  for (const name in literal()) names.push(name);
  return names;
});
logged("frozen, then stored to", () => {
  const frozen = Object.freeze(literal());
  const loose: { size: number } = frozen;
  loose.size = 3;
  return [frozen.size, frozen.kept];
});
