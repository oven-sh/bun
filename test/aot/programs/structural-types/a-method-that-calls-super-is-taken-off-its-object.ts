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

class Base {
  size: number = 1;
  name: string = "base";
  measure(): number {
    return this.size;
  }
  describe(): string {
    return "base " + this.name;
  }
  get doubled(): number {
    return this.size * 2;
  }
  set doubled(value: number) {
    this.size = value / 2;
  }
  static make(): string {
    return "made by " + this.name;
  }
}

class Derived extends Base {
  extra: number = 10;
  measure(): number {
    return super.measure() + this.extra;
  }
  describe(): string {
    return super.describe() + " derived";
  }
  onlySuper(): number {
    return super.measure();
  }
  superGetter(): number {
    return super.doubled;
  }
  superStore(): number {
    super.doubled = 100;
    return this.size;
  }
  arrowInside(): number {
    const inner = (): number => super.measure() + this.extra;
    return inner();
  }
  static make(): string {
    return super.make() + "!";
  }
}

const d = new Derived();
const { measure, describe, onlySuper, superGetter, superStore, arrowInside } = d;

show("honest measure", () => d.measure());
show("honest describe", () => d.describe());
show("honest superGetter", () => d.superGetter());
show("bare measure", () => measure());
show("bare describe", () => describe());
show("bare onlySuper", () => onlySuper());
show("bare superGetter", () => superGetter());
show("bare superStore", () => superStore());
show("bare arrowInside", () => arrowInside());

const like = { size: 100, name: "like", extra: 1000 };
show("on a look-alike: measure", () => d.measure.call(like));
show("on a look-alike: describe", () => d.describe.call(like));
show("on a look-alike: onlySuper", () => d.onlySuper.call(like));
show("on a look-alike: superGetter", () => d.superGetter.call(like));
show("on a look-alike: arrowInside", () => d.arrowInside.call(like));
show("on a look-alike: superStore", () => d.superStore.call(like));
show("the look-alike afterwards", () => JSON.stringify(like));
show("on a base instance: measure", () => d.measure.call(new Base()));
show("on a base instance: describe", () => d.describe.call(new Base()));
show("on a number: onlySuper", () => d.onlySuper.call(5));

const borrowed = { size: 7, name: "borrowed", extra: 70, measure: d.measure, describe: d.describe };
show("as a member of another object: measure", () => borrowed.measure());
show("as a member of another object: describe", () => borrowed.describe());

const make = Derived.make;
show("honest static", () => Derived.make());
show("bare static", () => make());
show("static on a look-alike", () => Derived.make.call({ name: "look-alike" }));

const original = Base.prototype.measure;
Base.prototype.measure = function (): number {
  return -1;
};
show("super sees a replaced method, on a look-alike", () => d.onlySuper.call(like));
Base.prototype.measure = original;
show("honest superStore", () => d.superStore());
show("keys afterwards", () => Object.keys(d).join());
