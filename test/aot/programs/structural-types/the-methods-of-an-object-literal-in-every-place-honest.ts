const meter = {
  reading: 3,
  read() {
    return this.reading * 2;
  },
  arrow: (n: number): number => n + 1,
  get level(): number {
    return this.reading + 100;
  },
  twice(): number {
    return this.read() + this.read();
  },
};

type Meter = typeof meter;

function make(): Meter {
  return {
    reading: 5,
    read() {
      return this.reading * 2;
    },
    arrow: n => n + 1,
    get level(): number {
      return this.reading + 100;
    },
    twice() {
      return this.read() + this.read();
    },
  };
}

class Holder {
  constructor(public meter: Meter) {}
  ask(): number {
    return this.meter.read();
  }
}

function byParameter(m: Meter): number {
  return m.read();
}

function byElement(list: Meter[]): number {
  return list[0].read();
}

const honest = make();
const holder = new Holder(meter);
const list = [meter];
const captured = (): number => meter.read();

function everywhere(label: string): void {
  const local = meter;
  console.log(label + ": " + [meter.read(), local.read(), byParameter(meter), holder.ask(), byElement(list), captured(), meter.twice(), meter.arrow(1), meter.level].join(" ") + " | honest " + [honest.read(), byParameter(honest), honest.twice(), honest.arrow(1)].join(" ") + " | keys " + Object.keys(meter).join());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += meter.read() + byParameter(meter) + holder.ask() + byElement(list) + captured() + meter.twice() + meter.arrow(i) + byParameter(honest);
console.log("2000 honest: " + warm);
everywhere("before");

export {};
