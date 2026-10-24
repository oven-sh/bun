const log: string[] = [];

class Bell {
  name = "bell";
  ring(times: number): string {
    return this.name + " rings " + times;
  }
}

function ringOf(b: Bell): string {
  return b.ring(2);
}

function ringTwice(b: Bell): string {
  return b.ring(1) + " & " + b.ring(1);
}

function line(label: string, value: string): void {
  console.log(label + ": " + value + " [" + log.join(", ") + "]");
  log.length = 0;
}

const b = new Bell();
const other = new Bell();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += ringOf(b).length + ringTwice(other).length;
line("2000 honest", String(warm));

const original = Bell.prototype.ring;
let handed = 0;

Object.defineProperty(b, "ring", {
  get() {
    const n = ++handed;
    log.push("own getter " + n);
    return (times: number) => "closure " + n + " rings " + times;
  },
  configurable: true,
});
line("an own getter", ringOf(b));
line("two calls read it twice", ringTwice(b));
line("read without a call", typeof b.ring + " " + (b.ring === b.ring));
line("the other bell", ringOf(other));
Reflect.deleteProperty(b, "ring");
line("uncovered", ringOf(b));

Object.defineProperty(Bell.prototype, "ring", {
  get(this: Bell) {
    log.push("prototype getter for " + this.name);
    return original;
  },
  configurable: true,
});
line("a getter on the prototype that hands out the method", ringOf(b) + " | " + ringTwice(other));

try {
  b.ring = () => "stored";
  line("a store with no setter", ringOf(b));
} catch (error) {
  line("a store with no setter threw", error instanceof Error ? error.constructor.name : typeof error);
}

Object.defineProperty(Bell.prototype, "ring", {
  get() {
    log.push("getter that throws");
    throw new RangeError("no bell");
  },
  configurable: true,
});
try {
  line("a getter that throws", ringOf(b));
} catch (error) {
  line("a getter that throws", "threw " + (error instanceof Error ? error.constructor.name : typeof error));
}

Object.defineProperty(Bell.prototype, "ring", { value: original, writable: true, configurable: true });
line("restored", ringOf(b) + " | " + ringTwice(other));

export {};
