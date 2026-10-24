const seen: string[] = [];
function note(label: string, value: unknown): void {
  seen.push(label + "=" + (value === undefined ? "undefined" : JSON.stringify(value)));
}
function keysOf(value: object): string {
  return Object.keys(value).join(",");
}

class Filled {
  count: number;
  ratio: number;
  flag: boolean;
  label: string;
  link: Filled | null;
  next: Filled;
  constructor(seed: number) {
    this.next = this;
    this.link = null;
    this.label = "l" + seed;
    this.flag = seed > 1;
    this.ratio = seed + 0.5;
    this.count = seed | 0;
  }
}

class ReadsFirst {
  count: number;
  constructor(seed: number) {
    note("ReadsFirst.count", (this as any).count);
    note("ReadsFirst has count", "count" in this);
    this.count = seed;
  }
}

class CallsMethod {
  first: number;
  second: number;
  constructor(seed: number) {
    this.first = seed;
    this.show();
    this.second = seed;
  }
  show(): void {
    note("CallsMethod.first", this.first);
    note("CallsMethod.second", this.second);
  }
}

class CapturesThis {
  count: number;
  read: () => number;
  constructor(seed: number) {
    this.read = () => this.count;
    note("CapturesThis.count", this.read());
    this.count = seed;
  }
}

class InitializerReads {
  count: number;
  early = (this as any).count as unknown;
  constructor(seed: number) {
    this.count = seed;
  }
}

class StoresOnOnePath {
  count!: number;
  constructor(seed: number) {
    if (seed > 1) this.count = seed;
  }
}

class ReadsItselfBack {
  self: ReadsItselfBack;
  count: number;
  constructor(seed: number) {
    this.self = this;
    note("ReadsItselfBack.count", this.self.count);
    this.count = seed;
  }
}

class ListsKeys {
  first: number;
  second: number;
  constructor(seed: number) {
    this.second = seed;
    note("ListsKeys", keysOf(this) + ":" + JSON.stringify(this));
    this.first = seed;
  }
}

const registry: object[] = [];
class Registers {
  constructor() {
    registry.push(this);
  }
}
class BelowRegisters extends Registers {
  early: number;
  late: number;
  constructor(seed: number) {
    super();
    this.early = seed;
    note("BelowRegisters.late", (registry[registry.length - 1] as BelowRegisters).late);
    this.late = seed;
  }
}

class Below extends Filled {
  extra: number;
  other: Filled;
  constructor(seed: number, other: Filled) {
    super(seed);
    this.extra = seed + 1;
    this.other = other;
  }
}

class Redeclares extends Filled {
  count: number;
  constructor(seed: number) {
    super(seed);
    note("Redeclares.count", (this as any).count);
    this.count = seed + 100;
  }
}

class ReverseOrder {
  z: number;
  y: number;
  x: number;
  constructor() {
    this.x = 1;
    this.y = 2;
    this.z = 3;
  }
}

let halfMade: ThrowsHalfway | undefined;
class ThrowsHalfway {
  first: number;
  second: number;
  constructor(seed: number, leak: boolean) {
    this.first = seed;
    if (leak) halfMade = this;
    if (seed > 5) throw new RangeError("too large");
    this.second = seed;
  }
}

class SetterBelow extends Filled {}
Object.defineProperty(SetterBelow.prototype, "count", {
  set(value: number) {
    note("SetterBelow.set count", value);
  },
  get() {
    return -1;
  },
  configurable: true,
});

function sum(head: Filled, steps: number): number {
  let total = 0;
  let at = head;
  for (let i = 0; i < steps; i++) {
    total = (total + at.count) | 0;
    total += at.ratio;
    if (at.flag) total += at.label.length;
    if (at.link !== null) total += at.link.count;
    at = at.next;
  }
  return total;
}

const a = new Filled(1), b = new Filled(2);
a.next = b;
b.next = a;
b.link = a;
console.log(sum(a, 1000), keysOf(a), JSON.stringify({ ...a, next: 0, link: 0 }));
console.log(new Filled(-2147483648).count, new Filled(-2147483646).count, new Filled(2147483647).count);
new ReadsFirst(1);
new CallsMethod(2);
new CapturesThis(3);
console.log(new InitializerReads(4).early, keysOf(new InitializerReads(4)));
console.log("count" in new StoresOnOnePath(0), new StoresOnOnePath(0).count, new StoresOnOnePath(2).count);
new ReadsItselfBack(5);
new ListsKeys(6);
new BelowRegisters(7);
const below = new Below(8, a);
console.log(below.extra, below.other === a, below.count, keysOf(below), sum(below, 3));
console.log(new Redeclares(9).count, keysOf(new Redeclares(9)));
console.log(keysOf(new ReverseOrder()));
for (const leak of [false, true]) {
  try {
    new ThrowsHalfway(9, leak);
  } catch (error) {
    console.log((error as Error).message, halfMade === undefined ? "nothing" : keysOf(halfMade) + ":" + halfMade.first + ":" + halfMade.second);
  }
}
const withSetter = new SetterBelow(10);
console.log(withSetter.count, keysOf(withSetter), Object.getOwnPropertyDescriptor(withSetter, "count")?.value);
console.log(seen.join("\n"));
