const log: string[] = [];

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()) + " [" + log.join(", ") + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join(", ") + "]");
  }
  log.length = 0;
}

class Base {
  protected stored = 1;
  get level(): number {
    log.push("Base get");
    return this.stored;
  }
  set level(value: number) {
    log.push("Base set " + value);
    this.stored = value;
  }
}

class OnlyGetter extends Base {
  get level(): number {
    log.push("OnlyGetter get");
    return -1;
  }
}

class OnlySetter extends Base {
  set level(value: number) {
    log.push("OnlySetter set " + value);
    this.stored = value * 100;
  }
}

class Both extends Base {
  get level(): number {
    log.push("Both get");
    return super.level + 1000;
  }
  set level(value: number) {
    log.push("Both set " + value);
    super.level = value + 1;
  }
}

class Untouched extends Base {}

function read(b: Base): number {
  return b.level;
}

function write(b: Base, value: number): number {
  b.level = value;
  return b.level;
}

function bump(b: Base): number {
  return ++b.level;
}

const makers: [string, () => Base][] = [
  ["the base", () => new Base()],
  ["a subclass that leaves it alone", () => new Untouched()],
  ["only the getter overridden", () => new OnlyGetter()],
  ["only the setter overridden", () => new OnlySetter()],
  ["both overridden", () => new Both()],
];

for (const [label, make] of makers) {
  attempt(label + ", read", () => read(make()));
  attempt(label + ", typeof", () => typeof read(make()));
  attempt(label + ", store", () => write(make(), 5));
  attempt(label + ", increment", () => bump(make()));
  attempt(label + ", plus one", () => read(make()) + 1);
  attempt(label + ", own", () => Object.hasOwn(make(), "level") + " " + Object.keys(make()).join());
}

const honest = new Base();
let sum = 0;
for (let i = 0; i < 2000; i++) sum += write(honest, i) + read(honest);
log.length = 0;
console.log("2000 honest: " + sum);
for (const [label, make] of makers) attempt("then " + label, () => write(make(), 7));

const list: Base[] = makers.map(([, make]) => make());
attempt("elements read", () => list.map(read).join());
attempt("elements stored", () => list.map(b => write(b, 1)).join());

class Holder {
  constructor(public inner: Base) {}
  raise(): number {
    this.inner.level += 10;
    return this.inner.level;
  }
}
for (const [label, make] of makers) attempt(label + ", through a field", () => new Holder(make()).raise());

export {};
