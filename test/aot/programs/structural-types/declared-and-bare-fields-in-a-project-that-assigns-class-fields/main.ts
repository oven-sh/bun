function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

class Base {
  kept: number | string = "from the base";
  watched: number = 0;
  constructor() {
    this.fill();
  }
  fill(): void {}
}

Object.defineProperty(Base.prototype, "traced", {
  get(): number {
    log.push("get traced");
    return 77;
  },
  set(value: number | undefined) {
    log.push("set traced " + value);
  },
  configurable: true,
});

class Child extends Base {
  declare kept: number;
  declare early: number;
  bare: number | undefined;
  optional?: number;
  traced?: number;
  given: number = 5;
  fill(): void {
    this.early = 1;
    this.bare = 2;
    this.optional = 3;
    this.given = 4;
  }
  sum(): number {
    return this.early + (this.bare ?? 100) + (this.optional ?? 1000) + this.given;
  }
  keptTwice(): number {
    return this.kept * 2;
  }
}

class Alone {
  declare never: number;
  bare: number | undefined;
  optional?: string;
  made: number = 1;
  neverPlusOne(): number {
    return this.never + 1;
  }
}

const child = new Child();
show("keys", () => Object.keys(child));
show("the declared one the base constructor stored", () => child.early);
show("the bare one the base constructor stored", () => child.bare);
show("the optional one the base constructor stored", () => child.optional);
show("the one with a value", () => child.given);
show("sum", () => child.sum());
show("the one narrowed by a declaration", () => [child.kept, typeof child.kept, child.keptTwice()]);
show("the one with an accessor above it", () => [child.traced, Object.hasOwn(child, "traced")]);
show("what ran", () => log.join());
show("JSON", () => JSON.stringify(child));

const alone = new Alone();
show("alone: keys", () => Object.keys(alone));
show("alone: in", () => ["never" in alone, "bare" in alone, "optional" in alone, "made" in alone]);
show("alone: read", () => [alone.never, alone.bare, alone.optional, alone.made]);
show("alone: the declared one plus one", () => alone.neverPlusOne());
show("alone: JSON", () => JSON.stringify(alone));
show("alone: spread", () => Object.keys({ ...alone }));
alone.optional = "late";
alone.never = 3;
alone.bare = 4;
show("alone: keys after stores", () => Object.keys(alone));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += new Child().sum();
show("2000 more", () => sum);
