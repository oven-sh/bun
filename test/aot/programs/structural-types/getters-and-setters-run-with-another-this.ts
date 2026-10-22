function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const log: string[] = [];

class Gauge {
  raw: number = 5;
  unit: string = "bar";
  #hidden: number = 9;
  get level(): number {
    log.push("get level");
    return this.raw * 2;
  }
  set level(value: number) {
    log.push("set level");
    this.raw = value / 2;
  }
  get text(): string {
    return this.raw + this.unit.toUpperCase();
  }
  get hidden(): number {
    return this.#hidden;
  }
  get self(): this {
    return this;
  }
}

const gauge = new Gauge();
const like = { raw: 50, unit: "psi" };
const wrong = { raw: "fifty", unit: 3 };
const empty = {};

show("honest level", () => gauge.level);
show("Reflect.get, no receiver", () => Reflect.get(gauge, "level"));
show("Reflect.get, a look-alike", () => Reflect.get(gauge, "level", like));
show("Reflect.get, wrong kinds", () => Reflect.get(gauge, "level", wrong));
show("Reflect.get, empty", () => Reflect.get(gauge, "level", empty));
show("Reflect.get, a number", () => Reflect.get(gauge, "level", 5));
show("Reflect.get text, a look-alike", () => Reflect.get(gauge, "text", like));
show("Reflect.get text, wrong kinds", () => Reflect.get(gauge, "text", wrong));
show("Reflect.get text, empty", () => Reflect.get(gauge, "text", empty));
show("Reflect.get hidden, a look-alike", () => Reflect.get(gauge, "hidden", like));
show("Reflect.get hidden, another gauge", () => Reflect.get(gauge, "hidden", new Gauge()));
show("Reflect.get self is the receiver", () => Reflect.get(gauge, "self", like) === like);
show("Reflect.set, a look-alike", () => Reflect.set(gauge, "level", 8, like));
show("the look-alike's raw", () => like.raw);
show("the gauge's raw", () => gauge.raw);
show("Reflect.set, empty", () => Reflect.set(gauge, "level", 8, empty));
show("keys of empty", () => Object.keys(empty).join());

const descriptor = Object.getOwnPropertyDescriptor(Gauge.prototype, "level");
show("the getter called on a look-alike", () => descriptor?.get?.call(like));
show("the getter called on nothing", () => descriptor?.get?.call(undefined));
show("the setter called on a look-alike", () => descriptor?.set?.call(like, 100));
show("the look-alike's raw", () => like.raw);

const child = Object.create(gauge);
show("through the prototype chain: level", () => child.level);
show("through the prototype chain: text", () => child.text);
show("through the prototype chain: hidden", () => child.hidden);
show("through the prototype chain: self is the child", () => child.self === child);
child.level = 40;
show("a store through the chain lands on the child", () => Object.keys(child).join());
show("the child's level", () => child.level);
show("the gauge's level", () => gauge.level);

const linked: { raw: number; unit: string } = { raw: 1, unit: "mm" };
Object.setPrototypeOf(linked, Gauge.prototype);
show("a literal linked to the class: level", () => Reflect.get(linked, "level"));
show("a literal linked to the class: hidden", () => Reflect.get(linked, "hidden"));
show("the prototype itself: level", () => Gauge.prototype.level);
show("the prototype itself: text", () => Gauge.prototype.text);
show("how often", () => log.length + " " + log.filter(entry => entry === "set level").length);
