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

class Sink {
  got: unknown[] = [];
  set level(value: number) {
    log.push("set " + String(value));
    this.got.push(value);
  }
}

const literal = {
  got: 0,
  set level(value: number) {
    log.push("literal set " + String(value));
    this.got = value;
  },
};

interface WriteOnly {
  set level(value: number);
}

class Child extends Sink {}

class Fixed {
  static got = 0;
  static set level(value: number) {
    log.push("static set " + String(value));
    Fixed.got = value;
  }
}

function half(n: number): number {
  return n / 2;
}

function uses(label: string, make: () => { level: number }): void {
  attempt(label + ": read", () => make().level);
  attempt(label + ": plus one", () => make().level + 1);
  attempt(label + ": handed on", () => half(make().level));
  attempt(label + ": to fixed", () => make().level.toFixed(1));
  attempt(label + ": kept in a constant", () => {
    const n: number = make().level;
    return [n, n * 2];
  });
  attempt(label + ": plus equals", () => (make().level += 1));
  attempt(label + ": increment", () => make().level++);
  attempt(label + ": or equals", () => (make().level ||= 5));
  attempt(label + ": nullish equals", () => (make().level ??= 5));
  attempt(label + ": destructured", () => {
    const { level } = make();
    return [level, level + 1];
  });
  attempt(label + ": destructured with a default", () => {
    const { level = 9 } = make();
    return level;
  });
  attempt(label + ": the name is there", () => "level" in make());
  attempt(label + ": keys", () => Object.keys(make()).join());
  attempt(label + ": as JSON", () => JSON.stringify(make()));
  attempt(label + ": copied by Object.assign", () => JSON.stringify(Object.assign({}, make())));
  attempt(label + ": filled by Object.assign", () => {
    const o = make();
    Object.assign(o, { level: 3 });
    return o.level;
  });
}

uses("a class", () => new Sink());
uses("a subclass", () => new Child());
uses("a literal", () => literal);
uses("a static member", () => Fixed);
attempt("through an interface", () => {
  const w: WriteOnly = new Sink();
  w.level = 4;
  return [w.level, w.level + 1];
});
attempt("a spread of the literal", () => {
  const copy = { ...literal };
  return [Object.keys(copy).join(), copy.level];
});
console.log(log.join(", "));
let sum = 0;
const plainOnes: { level: number }[] = [];
for (let i = 0; i < 2000; i++) plainOnes.push({ level: i });
plainOnes.push(new Sink());
for (const o of plainOnes) sum += o.level;
console.log("2000 plain members and one write-only member: " + sum);
