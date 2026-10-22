interface Thing {
  x: number;
  y: number;
  m(): number;
}

const log: string[] = [];

class Real {
  x = 1;
  y = 2;
  m(): number {
    return this.x + this.y;
  }
}

class Other {
  tag = "other";
  y = 20;
  x = 10;
  m(): number {
    return this.x - this.y;
  }
}

function forms(): [string, Thing][] {
  return [
    ["its own class", new Real()],
    ["a look-alike", new Other()],
    ["a literal in another order", { m: () => 34, y: 4, x: 3 }],
    [
      "accessors",
      {
        get x() {
          log.push("get x");
          return 5;
        },
        set x(value: number) {
          log.push("set x " + value);
        },
        y: 6,
        m: () => 56,
      },
    ],
    ["inherited", Object.create({ x: 7, y: 8, m: () => 78 })],
    ["frozen", Object.freeze({ x: 9, y: 10, m: () => 910 })],
    ["a proxy", new Proxy(new Other(), {})],
  ];
}

class Holder {
  static shared: Thing = new Real();
  thing: Thing = new Real();
  #hidden: Thing = new Real();
  readonly fixed: Thing;
  constructor(fixed: Thing = new Real()) {
    this.fixed = fixed;
  }
  read(): number {
    return this.thing.x * 100 + this.thing.y;
  }
  call(): number {
    return this.thing.m();
  }
  store(value: number): number {
    this.thing.x = value;
    return this.thing.x;
  }
  keys(): string {
    return Object.keys(this.thing).join("");
  }
  hide(thing: Thing): void {
    this.#hidden = thing;
  }
  hidden(): number {
    return this.#hidden.x + this.#hidden.m();
  }
  fromFixed(): number {
    return this.fixed.x + this.fixed.m();
  }
  static fromShared(): number {
    return Holder.shared.x + Holder.shared.m();
  }
  loop(times: number): number {
    let total = 0;
    for (let i = 0; i < times; i++) total += this.thing.y;
    return total;
  }
}

function attempt(body: () => unknown): string {
  try {
    return String(body());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

const holder = new Holder();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += holder.read() + holder.call() + holder.store(1) + holder.hidden() + holder.fromFixed() + Holder.fromShared();
console.log("2000 honest rounds: " + warm);

for (const [label, thing] of forms()) {
  holder.thing = thing;
  holder.hide(thing);
  Holder.shared = thing;
  const line = [
    attempt(() => holder.read()),
    attempt(() => holder.call()),
    attempt(() => holder.store(50)),
    attempt(() => holder.read()),
    attempt(() => holder.keys()),
    attempt(() => holder.hidden()),
    attempt(() => new Holder(thing).fromFixed()),
    attempt(() => Holder.fromShared()),
    attempt(() => holder.loop(3)),
  ];
  console.log(label + ": " + line.join(" | ") + " [" + log.length + " accessor calls]");
  log.length = 0;
}

holder.thing = new Real();
console.log("its own class again: " + holder.read() + " " + holder.call() + " " + holder.keys());

const holders: Holder[] = forms().map(([, thing]) => {
  const h = new Holder();
  h.thing = thing;
  return h;
});
console.log("one holder for each form: " + holders.map(h => h.read()).join());
console.log("json: " + JSON.stringify(holders));
log.length = 0;

const swapping = new Holder();
const trace: number[] = [];
for (let i = 0; i < 2004; i++) {
  if (i === 2001) swapping.thing = new Other();
  const value = swapping.read();
  if (i >= 2000) trace.push(value);
}
console.log("reassigned in the middle of a loop: " + trace.join());

export {};
