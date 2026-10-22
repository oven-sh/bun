class Owner {
  first: string = "ann";
}

class Subject {
  count: number = 10;
  label: string = "subject";
  owner: Owner = new Owner();
  action: () => number = () => 7;
  #secret: number = 42;
  readCount(): number {
    return this.count;
  }
  countPlusOne(): number {
    return this.count + 1;
  }
  readLabel(): string {
    return this.label;
  }
  labelLength(): number {
    return this.label.length;
  }
  ownerName(): string {
    return this.owner.first;
  }
  runAction(): number {
    return this.action();
  }
  readSecret(): number {
    return this.#secret;
  }
  storeCount(): number {
    this.count = 99;
    return this.count;
  }
  bump(): number {
    return ++this.count;
  }
  storeLabel(): string {
    this.label = "stored";
    return this.label;
  }
  callsOther(): number {
    return this.readCount() * 2;
  }
  kind(): string {
    return typeof this;
  }
}

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

const s = new Subject();

function fixed(): object {
  const o = { count: 1, label: "fixed" };
  Object.defineProperty(o, "count", { writable: false });
  Object.defineProperty(o, "label", { writable: false });
  return o;
}
function args(...rest: number[]): object {
  return (function (this: unknown): object {
    return arguments;
  })();
}

const makers: [string, () => unknown][] = [
  ["sealed subject", () => Object.seal(new Subject())],
  ["sealed, empty", () => Object.seal({})],
  ["not extensible, empty", () => Object.preventExtensions({})],
  ["not extensible, with a count", () => Object.preventExtensions({ count: 1 })],
  ["frozen literal", () => Object.freeze({ count: 1, label: "frozen" })],
  ["members that cannot be written", fixed],
  ["inherits members that cannot be written", () => Object.create(fixed())],
  ["only a getter", () => ({ get count() { return 1; }, get label() { return "getter"; } })],
  ["a typed array", () => new Uint8Array(2)],
  ["a string object", () => new String("text")],
  ["a string", () => "text"],
  ["a number", () => 5],
  ["a bigint", () => 5n],
  ["a symbol", () => Symbol.iterator],
  ["arguments", () => args()],
  ["a function", () => function plain() {}],
  ["a class", () => class Plain {}],
];

for (const [name, make] of makers) {
  show(name + ": storeCount", () => s.storeCount.call(make()));
  show(name + ": bump", () => s.bump.call(make()));
  show(name + ": storeLabel", () => s.storeLabel.call(make()));
  show(name + ": readCount", () => s.readCount.call(make()));
  show(name + ": kind", () => s.kind.call(make()));
  show(name + ": what is left", () => {
    const receiver = make();
    try {
      s.storeCount.call(receiver);
    } catch (error) {}
    return receiver instanceof Object ? Object.getOwnPropertyNames(receiver).length : "a primitive";
  });
}
