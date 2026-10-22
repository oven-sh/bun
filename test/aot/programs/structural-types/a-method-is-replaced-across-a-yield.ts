class Lamp {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  color(): string {
    return "method of " + this.name;
  }
  *watch(): Generator<string, string, void> {
    yield this.color();
    yield this.color();
    yield this.color();
    return this.color();
  }
  static kind(): string {
    return "static method";
  }
}

function* watch(l: Lamp): Generator<string, string, void> {
  yield l.color();
  yield l.color();
  yield l.color();
  return l.color();
}

function* watchLoop(l: Lamp, rounds: number): Generator<string, void, void> {
  for (let i = 0; i < rounds; i++) yield l.color() + " / " + Lamp.kind();
}

const original = Lamp.prototype.color;
const originalKind = Lamp.kind;

function drive(label: string, l: Lamp, it: Generator<string, string, void>): void {
  const seen: string[] = [];
  seen.push(String(it.next().value));
  l.color = () => "own";
  seen.push(String(it.next().value));
  Reflect.deleteProperty(l, "color");
  Lamp.prototype.color = function () {
    return "patched for " + this.name;
  };
  seen.push(String(it.next().value));
  Lamp.prototype.color = original;
  seen.push(String(it.next().value));
  console.log(label + ": " + seen.join(" | "));
}

const a = new Lamp("a");
drive("a generator function", a, watch(a));
const b = new Lamp("b");
drive("a generator method", b, b.watch());

const c = new Lamp("c");
let step = 0;
for (const seen of watchLoop(c, 8)) {
  console.log("for-of, step " + step + ": " + seen);
  if (step === 0) c.color = () => "own";
  if (step === 1) Lamp.kind = () => "patched static";
  if (step === 2) Reflect.deleteProperty(c, "color");
  if (step === 3) Lamp.prototype.color = () => "arrow on the prototype";
  if (step === 4) Lamp.kind = originalKind;
  if (step === 5) Lamp.prototype.color = original;
  step++;
}

const d = new Lamp("d");
let count = 0;
let last = "";
for (const seen of watchLoop(d, 2003)) {
  count++;
  last = seen;
  if (count === 2000) d.color = () => "own after 2000";
  if (count > 2000) console.log("step " + count + ": " + seen);
}
console.log("the last: " + last);

function* delegating(l: Lamp): Generator<string, void, void> {
  const inner = yield* watch(l);
  yield "returned " + inner + ", now " + l.color();
}

const e = new Lamp("e");
const outer = delegating(e);
const through: string[] = [];
for (let r = outer.next(); !r.done; r = outer.next()) {
  through.push(r.value);
  if (through.length === 2) e.color = () => "own";
}
console.log("through yield*: " + through.join(" | "));

export {};
