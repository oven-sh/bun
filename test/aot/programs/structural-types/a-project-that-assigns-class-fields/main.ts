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

class Base {
  stored: string[] = [];
  declare tracked: number;
  constructor() {
    this.init();
  }
  init(): void {}
}

Object.defineProperty(Base.prototype, "tracked", {
  set(this: Base, value: number) {
    log.push("set-tracked:" + value);
    this.stored.push("tracked=" + value);
  },
  get() {
    return -1;
  },
  configurable: true,
});

class Derived extends Base {
  tracked = 5;
  declared: number | undefined;
  early = "field";
  init(): void {
    this.early = "set by init";
    this.declared = 7;
  }
}

class OnlyDeclared {
  a: number | undefined;
  b?: string;
  c: number | undefined = undefined;
  declare d: number | undefined;
  static s: number | undefined;
}

class Ordered {
  first = log.push("first");
  constructor(public second: number = log.push("second")) {
    log.push("body");
  }
  third = log.push("third");
  sum(): number {
    return this.first + this.second + this.third;
  }
}

class ReadsParameter {
  copy = this.read();
  constructor(public given: number) {}
  read(): number {
    return this.given;
  }
}

class Frozen {
  constructor() {
    return Object.freeze(this);
  }
}

class OnFrozen extends Frozen {
  value = 1;
}

const computed = "computed1";

class Named {
  static name2 = "static";
  [computed] = 1;
  0 = "zero";
  "quoted key" = true;
}

function describe(o: object): string {
  return Reflect.ownKeys(o)
    .map(key => {
      const d = Reflect.getOwnPropertyDescriptor(o, key);
      return String(key) + ":" + (d === undefined ? "?" : "value" in d ? show(d.value) : "accessor");
    })
    .join(" ");
}

attempt("a field over an inherited accessor", () => {
  const d = new Derived();
  return [describe(d), d.tracked, d.stored];
});
attempt("a declared field after the base constructor stored to it", () => {
  const d = new Derived();
  return [d.declared, d.early, "declared" in d, Object.hasOwn(d, "declared")];
});
attempt("fields that are only declared", () => {
  const o = new OnlyDeclared();
  return [describe(o), "a" in o, "b" in o, "c" in o, "d" in o, Object.keys(o), JSON.stringify(o), "s" in OnlyDeclared];
});
attempt("the order of initializers and parameter properties", () => {
  const o = new Ordered();
  return [describe(o), o.sum()];
});
attempt("an initializer reads a parameter property", () => describe(new ReadsParameter(9)));
attempt("a field on an object the base constructor froze", () => describe(new OnFrozen()));
attempt("computed, numeric and quoted names", () => [describe(new Named()), Object.keys(Named)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Derived().tracked + new Ordered(i).sum() + Object.keys(new OnlyDeclared()).length + new ReadsParameter(i).given;
log.length = 0;
console.log("2000 rounds", warm);
attempt("a setter appears on the prototype later", () => {
  class Plain {
    value = 1;
  }
  const before = describe(new Plain());
  Object.defineProperty(Plain.prototype, "value", { set: (v: number) => void log.push("late-setter:" + v), get: () => "from the prototype", configurable: true });
  const after = new Plain();
  return [before, describe(after), after.value];
});
