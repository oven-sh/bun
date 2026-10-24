const log: string[] = [];

interface Base {
  level: number;
}

class Base {
  hidden = 1;
  read(): number {
    return this.level;
  }
  raise(): number {
    this.level += 1;
    return this.level;
  }
}

Object.defineProperty(Base.prototype, "level", {
  get(this: Base) {
    log.push("get");
    return this.hidden * 10;
  },
  set(this: Base, value: number) {
    log.push("set " + value);
    this.hidden = value;
  },
  configurable: true,
});

class Plain extends Base {}

class WithField extends Base {
  level = 5;
}

class WithEmptyField extends Base {
  level: number;
  constructor() {
    super();
    log.push("own before the store: " + Object.hasOwn(this, "level"));
    this.level = 6;
  }
}

class WithDeclaredField extends Base {
  declare level: number;
}

function read(b: Base): number {
  return b.level;
}

function write(b: Base, value: number): number {
  b.level = value;
  return b.level;
}

function attempt(label: string, body: () => unknown): void {
  log.length = 0;
  try {
    console.log(label + ": " + String(body()) + " [" + log.join(", ") + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join(", ") + "]");
  }
}

const makers: [string, () => Base][] = [
  ["the base", () => new Base()],
  ["a plain subclass", () => new Plain()],
  ["a field with an initializer", () => new WithField()],
  ["a field stored by the constructor", () => new WithEmptyField()],
  ["a field that is only declared", () => new WithDeclaredField()],
];

for (const [label, make] of makers) {
  attempt(label + ", made", () => JSON.stringify(make()));
  attempt(label + ", read", () => read(make()));
  attempt(label + ", read by a method of the base", () => make().read());
  attempt(label + ", stored", () => {
    const made = make();
    return write(made, 7) + " hidden " + made.hidden;
  });
  attempt(label + ", raised by a method of the base", () => {
    const made = make();
    return made.raise() + " hidden " + made.hidden;
  });
  attempt(label + ", own", () => Object.hasOwn(make(), "level") + " keys " + Object.keys(make()).join());
}

const honest = new Base();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += write(honest, i) + read(honest);
console.log("2000 with the accessor: " + warm);
for (const [label, make] of makers) attempt("then " + label, () => write(make(), 3) + " " + make().raise());

export {};
