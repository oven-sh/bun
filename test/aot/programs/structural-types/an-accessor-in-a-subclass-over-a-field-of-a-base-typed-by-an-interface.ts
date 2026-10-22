const log: string[] = [];

interface Leveled {
  level: number;
  read(): number;
}

const Base: new () => Leveled = class {
  level = 1;
  read(): number {
    return this.level;
  }
};

class Pair extends Base {
  get level(): number {
    log.push("get");
    return 42;
  }
  set level(value: number) {
    log.push("set " + value);
  }
}

class Plain extends Base {}

function read(l: Leveled): number {
  return l.level;
}

function write(l: Leveled, value: number): number {
  l.level = value;
  return l.level;
}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

for (const [name, make] of [
  ["the base", () => new Base()],
  ["a plain subclass", () => new Plain()],
  ["a subclass with a pair", () => new Pair()],
] satisfies [string, () => Leveled][]) {
  line(name + ", made", JSON.stringify(make()) + " own " + Object.hasOwn(make(), "level"));
  line(name + ", read", read(make()) + " " + make().read());
  line(name + ", stored", write(make(), 5));
}

const pair = new Pair();
Reflect.deleteProperty(pair, "level");
line("the own field deleted, the pair shows", read(pair) + " " + pair.read() + " " + write(pair, 6) + " own " + Object.hasOwn(pair, "level"));

export {};
