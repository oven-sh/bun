class Meter {
  length = 1;
  unit(): string {
    return "meter";
  }
  get doubled(): number {
    return this.length * 2;
  }
  toString(): string {
    return this.length + " m";
  }
}

class Foot {
  length = 3;
  unit(): string {
    return "foot";
  }
  get doubled(): number {
    return this.length * 20;
  }
  toString(): string {
    return this.length + " ft";
  }
}

function report(m: Meter): string {
  return [
    m.unit(),
    m.length,
    m.doubled,
    String(m),
    `${m}`,
    m instanceof Meter,
    m instanceof Foot,
    m.constructor === Meter,
    m.constructor.name,
    Object.getPrototypeOf(m) === Meter.prototype,
    Meter.prototype.isPrototypeOf(m),
  ].join(" ");
}

function make(real: boolean): Meter {
  return real ? new Meter() : new Foot();
}

class Ruler {
  measure: Meter;
  constructor(measure: Meter) {
    this.measure = measure;
  }
  report(): string {
    return this.measure.unit() + " " + this.measure.doubled + " " + (this.measure instanceof Meter);
  }
}

const local: Meter = new Foot();
console.log("local: " + local.unit() + " " + local.length + " " + local.doubled + " " + local);
console.log("local instanceof Meter: " + (local instanceof Meter));
console.log("local constructor: " + local.constructor.name + " " + (local.constructor === Meter));

console.log("parameter, a Foot: " + report(new Foot()));
console.log("parameter, a Meter: " + report(new Meter()));
console.log("result, a Foot: " + report(make(false)));
console.log("result, a Meter: " + report(make(true)));
console.log("result used at once: " + make(false).unit() + " " + make(false).doubled + " " + (make(false) instanceof Meter));
console.log("field, a Foot: " + new Ruler(new Foot()).report());
console.log("field, a Meter: " + new Ruler(new Meter()).report());

const list: Meter[] = [new Meter(), new Foot(), new Meter(), new Foot()];
console.log("elements: " + list.map(m => m.unit()).join());
console.log("elements instanceof: " + list.map(m => m instanceof Meter).join());
console.log("elements doubled: " + list.map(m => m.doubled).join());
console.log("only real ones: " + list.filter(m => m instanceof Meter).length);
console.log("joined: " + list.join("; "));

const captured = () => local.unit() + " " + (local instanceof Meter);
console.log("captured: " + captured());

let slot: Meter = new Meter();
const seen: string[] = [];
for (let i = 0; i < 6; i++) {
  seen.push(slot.unit() + ":" + (slot instanceof Meter));
  slot = i % 2 === 0 ? new Foot() : new Meter();
}
console.log("one variable, both classes: " + seen.join());

if (local instanceof Meter) {
  console.log("the Meter branch ran");
} else {
  console.log("the other branch ran");
}

console.log("borrowed method: " + Meter.prototype.unit.call(local) + " " + Meter.prototype.toString.call(local));
const getter = Object.getOwnPropertyDescriptor(Meter.prototype, "doubled");
console.log("borrowed getter: " + (getter !== undefined && getter.get !== undefined ? getter.get.call(local) : "none"));

export {};
