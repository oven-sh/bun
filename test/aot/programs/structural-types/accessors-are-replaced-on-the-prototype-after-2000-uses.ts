const log: string[] = [];

class Tank {
  liters = 5;
  get level(): number {
    return this.liters;
  }
  set level(value: number) {
    this.liters = value;
  }
  fill(): number {
    this.level += 1;
    return this.level;
  }
}

class Small extends Tank {}

function read(t: Tank): number {
  return t.level;
}

function write(t: Tank, value: number): number {
  t.level = value;
  return t.liters;
}

function bump(t: Tank): number {
  return t.level++;
}

const t = new Tank();
const small = new Small();

function round(label: string): void {
  t.liters = 5;
  small.liters = 5;
  const parts = [read(t), write(t, 7), bump(t), t.liters, t.fill(), read(small), write(small, 8), small.fill()];
  console.log(label + ": " + parts.join(" ") + " [" + log.join(", ") + "]");
  log.length = 0;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += read(t) + write(t, i) + bump(t) + t.fill() + read(small);
console.log("2000 honest: " + warm);
round("before");

const original = Object.getOwnPropertyDescriptor(Tank.prototype, "level");

Object.defineProperty(Tank.prototype, "level", {
  get(this: Tank) {
    log.push("get");
    return this.liters * 10;
  },
  set(this: Tank, value: number) {
    log.push("set " + value);
    this.liters = value + 0.5;
  },
  configurable: true,
});
round("both replaced");

Object.defineProperty(Tank.prototype, "level", {
  get(this: Tank) {
    log.push("get only");
    return -1;
  },
  set: undefined,
  configurable: true,
});
try {
  round("no setter any more");
} catch (error) {
  console.log("no setter any more: threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join(", ") + "]");
  log.length = 0;
}

Object.defineProperty(Tank.prototype, "level", { value: 42, writable: true, configurable: true });
round("a plain value on the prototype");
console.log("own level now: " + Object.hasOwn(t, "level") + " " + Object.hasOwn(small, "level") + ", keys " + Object.keys(t).join());
Reflect.deleteProperty(t, "level");
Reflect.deleteProperty(small, "level");

Object.defineProperty(Small.prototype, "level", {
  get() {
    log.push("small get");
    return 1000;
  },
  set(value: number) {
    log.push("small set " + value);
  },
  configurable: true,
});
if (original) Object.defineProperty(Tank.prototype, "level", original);
round("the base restored, the subclass got its own pair");

Reflect.deleteProperty(Small.prototype, "level");
round("restored");

export {};
