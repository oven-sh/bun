const log: string[] = [];

interface Base {
  level: number;
}

class Base {
  other = "other";
  constructor(level: number) {
    this.level = level;
  }
  read(): number {
    return this.level;
  }
  raise(): number {
    this.level += 1;
    return this.level;
  }
}

class Plain extends Base {}

class Pair extends Base {
  get level(): number {
    log.push("get");
    return 42;
  }
  set level(value: number) {
    log.push("set " + value);
  }
}

class Keeping extends Base {
  declare kept: number;
  get level(): number {
    log.push("get kept");
    return this.kept * 10;
  }
  set level(value: number) {
    log.push("keep " + value);
    this.kept = value;
  }
}

class OnlyGetter extends Base {
  get level(): number {
    log.push("get only");
    return -1;
  }
}

function read(b: Base): number {
  return b.level;
}

function write(b: Base, value: number): number {
  b.level = value;
  return b.level;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()) + " [" + log.join(", ") + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join(", ") + "]");
  }
  log.length = 0;
}

const makers: [string, () => Base][] = [
  ["the base", () => new Base(1)],
  ["a plain subclass", () => new Plain(1)],
  ["a pair", () => new Pair(1)],
  ["a pair that keeps the value", () => new Keeping(1)],
  ["only a getter", () => new OnlyGetter(1)],
];

for (const [label, make] of makers) {
  attempt(label + ", made", () => Object.keys(make()).join() + " " + JSON.stringify(make()));
  attempt(label + ", read", () => read(make()));
  attempt(label + ", read by a method of the base", () => make().read());
  attempt(label + ", stored", () => write(make(), 5));
  attempt(label + ", raised by a method of the base", () => make().raise());
  attempt(label + ", own", () => Object.hasOwn(make(), "level"));
}

let warm = 0;
const honest = new Base(0);
for (let i = 0; i < 2000; i++) warm += write(honest, i) + read(honest) + honest.raise() + new Base(i).read();
console.log("2000 honest: " + warm);
for (const [label, make] of makers) attempt("then " + label, () => write(make(), 7) + " " + make().raise());

export {};
