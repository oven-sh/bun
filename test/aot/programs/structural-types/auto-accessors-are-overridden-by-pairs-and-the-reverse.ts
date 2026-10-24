const log: string[] = [];

class Base {
  accessor level = 1;
  read(): number {
    return this.level;
  }
  raise(): number {
    return ++this.level;
  }
}

class Pair extends Base {
  get level(): number {
    log.push("get");
    return super.level + 100;
  }
  set level(value: number) {
    log.push("set " + value);
    super.level = value * 2;
  }
}

class Again extends Base {
  accessor level = 50;
  above(): number {
    return super.level;
  }
}

class Written {
  stored = 7;
  get level(): number {
    log.push("written get");
    return this.stored;
  }
  set level(value: number) {
    log.push("written set " + value);
    this.stored = value;
  }
  read(): number {
    return this.level;
  }
}

class Auto extends Written {
  accessor level = 9;
}

function read(b: Base): number {
  return b.level;
}

function write(b: Base, value: number): number {
  b.level = value;
  return b.level;
}

function line(label: string, body: () => unknown): void {
  log.length = 0;
  try {
    console.log(label + ": " + String(body()) + " [" + log.join(", ") + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join(", ") + "]");
  }
}

const makers: [string, () => Base][] = [
  ["the base", () => new Base()],
  ["a pair over it", () => new Pair()],
  ["another auto-accessor over it", () => new Again()],
];

for (const [label, make] of makers) {
  line(label + ", made", () => JSON.stringify(make()) + " own " + Object.hasOwn(make(), "level"));
  line(label + ", read", () => read(make()) + " " + make().read());
  line(label + ", stored", () => write(make(), 5));
  line(label + ", raised", () => make().raise());
}

line("two stores of their own", () => {
  const again = new Again();
  again.level = 60;
  return again.level + " " + again.above() + " " + again.read();
});

line("an auto-accessor over a written pair", () => {
  const auto = new Auto();
  const before = auto.level + " " + auto.read() + " " + auto.stored;
  auto.level = 10;
  return before + " then " + auto.level + " " + auto.read() + " " + auto.stored + " keys " + Object.keys(auto).join();
});

const honest = new Base();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += write(honest, i) + read(honest) + honest.raise();
console.log("2000 honest: " + warm);
for (const [label, make] of makers) line("then " + label, () => write(make(), 3) + " " + make().raise());

const descriptor = Object.getOwnPropertyDescriptor(Base.prototype, "level");
Object.defineProperty(Base.prototype, "level", { get: () => -5, set: () => {}, configurable: true });
for (const [label, make] of makers) line("the base's accessor replaced, " + label, () => read(make()) + " " + make().read());
if (descriptor) Object.defineProperty(Base.prototype, "level", descriptor);
for (const [label, make] of makers) line("restored, " + label, () => read(make()) + " " + make().read());

export {};
