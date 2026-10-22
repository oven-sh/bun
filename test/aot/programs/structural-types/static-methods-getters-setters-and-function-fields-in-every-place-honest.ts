class Ids {
  static last = 0;
  static next(): number {
    return ++Ids.last;
  }
  static pair(): string {
    return Ids.next() + "," + this.next();
  }
}

class Tank {
  liters = 5;
  step: (n: number) => number;
  constructor(amount: number) {
    this.step = n => n + amount;
  }
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
  run(n: number): number {
    return this.step(this.step(n));
  }
}

class Holder {
  source: typeof Ids = Ids;
  tank: Tank;
  constructor(tank: Tank) {
    this.tank = tank;
  }
  ask(): number {
    return this.source.next() + this.tank.level + this.tank.step(1);
  }
}

function byParameter(c: typeof Ids, t: Tank): number {
  return c.next() + t.level + t.step(1);
}

function byElement(classes: (typeof Ids)[], tanks: Tank[]): number {
  return classes[0].next() + tanks[0].level + tanks[0].step(1);
}

function write(t: Tank, value: number): number {
  t.level = value;
  return t.liters;
}

const meter = {
  reading: 3,
  read() {
    return this.reading * 2;
  },
  get level(): number {
    return this.reading + 100;
  },
};

function readOf(m: typeof meter): number {
  return m.read() + m.level;
}

const tank = new Tank(1);
const holder = new Holder(tank);
const captured = (): number => Ids.next() + tank.level + tank.step(1);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += byParameter(Ids, tank) + holder.ask() + byElement([Ids], [tank]) + captured() + write(tank, i % 7) + tank.fill() + tank.run(i) + readOf(meter);
Ids.last = 0;
tank.liters = 5;
console.log("2000 rounds: " + warm);
console.log("directly: " + Ids.next() + " " + tank.level + " " + tank.step(1) + " " + Ids.pair());
console.log("a parameter: " + byParameter(Ids, tank));
console.log("a field: " + holder.ask());
console.log("an element: " + byElement([Ids], [tank]));
console.log("captured: " + captured());
console.log("a store: " + write(tank, 9) + " " + tank.fill() + " " + tank.run(1));
console.log("a literal: " + readOf(meter) + " " + meter.read() + " " + meter.level);

export {};
