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

const tag = Symbol("tag");

class Meter {
  static base: number = 100;
  static get doubled(): number {
    return this.base * 2;
  }
  static set doubled(value: number) {
    this.base = value / 2;
  }
  unit: string = "m";
  value: number = 5;
  [tag](): string {
    return this.value + this.unit;
  }
  [Symbol.toPrimitive](hint: string): string | number {
    return hint === "number" ? this.value : this.value + this.unit;
  }
  get [Symbol.toStringTag](): string {
    return "Meter of " + this.unit;
  }
  ["computed" + "Name"](): number {
    return this.value;
  }
}
class Sub extends Meter {
  static base: number = 7;
}

const meter = new Meter();
const like = { value: 50, unit: "km" };

show("honest static getter", () => Meter.doubled);
show("on the subclass", () => Sub.doubled);
show("Reflect.get with a look-alike", () => Reflect.get(Meter, "doubled", { base: 1 }));
show("Reflect.get with nothing to read", () => Reflect.get(Meter, "doubled", {}));
show("Reflect.get with an instance", () => Reflect.get(Meter, "doubled", meter));
show("Reflect.set with a look-alike", () => {
  const target = { base: 0 };
  return Reflect.set(Meter, "doubled", 10, target) + " " + target.base + " " + Meter.base;
});
Sub.doubled = 40;
show("a store on the subclass", () => Sub.base + " " + Meter.base);

show("honest symbol-named method", () => meter[tag]());
show("taken off", () => {
  const f = meter[tag];
  return f();
});
show("on a look-alike", () => meter[tag].call(like));
show("borrowed under the same symbol", () => ({ value: 1, unit: "cm", [tag]: meter[tag] })[tag]());
show("honest conversion", () => `${meter}` + " " + +meter);
show("the converter, taken off", () => {
  const convert = meter[Symbol.toPrimitive];
  return convert("number");
});
show("the converter, borrowed", () => {
  const borrowed = { value: 9, unit: "mm", [Symbol.toPrimitive]: meter[Symbol.toPrimitive] };
  return `${borrowed}` + " " + +borrowed;
});
show("the converter, borrowed without fields", () => {
  const borrowed = { [Symbol.toPrimitive]: meter[Symbol.toPrimitive] };
  return `${borrowed}` + " " + +borrowed;
});
show("the tag getter", () => Object.prototype.toString.call(meter));
show("the tag getter on a child", () => Object.prototype.toString.call(Object.create(meter)));
show("the tag getter on the prototype", () => Object.prototype.toString.call(Meter.prototype));
show("the tag getter with a receiver", () => Reflect.get(meter, Symbol.toStringTag, like));
