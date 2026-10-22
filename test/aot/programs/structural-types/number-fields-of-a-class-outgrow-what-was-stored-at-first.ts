function text(n: number): string {
  return Object.is(n, -0) ? "-0" : String(n);
}

class Meter {
  ticks = 0;
  total = 0;
  scale = 1;
  tick(): number {
    return ++this.ticks;
  }
  add(n: number): number {
    this.total += n;
    return this.total;
  }
  scaled(): number {
    return this.total * this.scale;
  }
  masked(): number {
    return (this.ticks | 0) + (this.total | 0);
  }
}

interface Numbers {
  ticks: number;
  total: number;
  scale: number;
}

function state(m: Meter): string {
  return [m.ticks, m.total, m.scale, m.scaled(), m.masked()].map(text).join(" ") + " " + JSON.stringify(m);
}

const warm = new Meter();
for (let i = 0; i < 2000; i++) {
  warm.tick();
  warm.add(1);
}
console.log("2000 small whole numbers: " + state(warm));

const overflow = new Meter();
overflow.ticks = 2147483646;
console.log("++ past the limit: " + [overflow.tick(), overflow.tick(), overflow.tick()].join() + " " + state(overflow));

const sums = new Meter();
sums.add(2147483647);
console.log("+= past the limit: " + sums.add(1) + " " + sums.add(2147483647) + " " + state(sums));

const negative = new Meter();
negative.add(-2147483648);
console.log("below the limit: " + negative.add(-1) + " " + state(negative));

const product = new Meter();
product.total = 65536;
product.scale = 65536;
console.log("a product past the limit: " + state(product));

const fraction = new Meter();
console.log("a fraction arrives late: " + fraction.add(1) + " " + fraction.add(0.5) + " " + state(fraction));

const zero = new Meter();
zero.scale = -1;
console.log("zero times minus one: " + text(zero.scaled()) + " " + state(zero));
zero.total = zero.scaled();
console.log("stored back: " + text(zero.total) + " " + text(1 / zero.total) + " " + state(zero));

const special = new Meter();
special.total = 0 / 0;
console.log("not a number: " + state(special) + " " + text(special.add(1)));
special.total = 1 / 0;
console.log("infinity: " + state(special) + " " + text(special.add(-Infinity)));

const aliased = new Meter();
const numbers: Numbers = aliased;
numbers.ticks = 0.25;
numbers.total = 1e300;
numbers.scale = 1e300;
console.log("stored through an interface: " + state(aliased) + " " + aliased.tick());

const assigned = new Meter();
Object.assign(assigned, { ticks: 4294967296, total: -0 });
console.log("Object.assign: " + state(assigned) + " " + assigned.tick());

const reflected = new Meter();
Reflect.set(reflected, "ticks", 9007199254740992);
console.log("Reflect.set: " + state(reflected) + " " + reflected.tick());

const parsed = new Meter();
parsed.total = Number("1.75");
parsed.ticks = parseInt("3000000000", 10);
parsed.scale = Number.MAX_SAFE_INTEGER;
console.log("numbers out of text: " + state(parsed));

const meters: Meter[] = [warm, overflow, sums, negative, product, fraction, zero, special, aliased, assigned, reflected, parsed];
console.log("all ticks: " + meters.map(m => text(m.ticks)).join());
console.log("all totals: " + meters.map(m => text(m.total)).join());
let sum = 0;
for (const m of meters) if (Number.isFinite(m.total)) sum += m.total;
console.log("the finite totals: " + sum);

const unsigned = new Meter();
unsigned.total = -1 >>> 0;
console.log("an unsigned shift: " + state(unsigned));
unsigned.total = unsigned.total % -4294967295;
console.log("a remainder: " + text(unsigned.total));
unsigned.total = -unsigned.total;
console.log("negated: " + text(unsigned.total));

export {};
