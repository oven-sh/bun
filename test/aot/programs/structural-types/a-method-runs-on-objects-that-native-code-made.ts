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
const literal = {
  count: 1,
  label: "literal",
  read(): number {
    return this.count;
  },
  size(): number {
    return this.label.length;
  },
  bump(): number {
    return ++this.count;
  },
};

const makers: [string, () => object][] = [
  ["JSON.parse", () => JSON.parse('{"label":"parsed","count":6}')],
  ["JSON.parse, other kinds", () => JSON.parse('{"count":"six","label":7}')],
  ["structuredClone", () => structuredClone({ count: 7, label: "cloned" })],
  ["structuredClone of the subject", () => structuredClone(s)],
  ["Object.assign", () => Object.assign({}, { count: 8, label: "assigned" })],
  ["Object.create", () => Object.create({ count: 9, label: "inherited" })],
  ["Object.create(null)", () => Object.create(null)],
  ["Object.groupBy", () => Object.groupBy([1, 2], n => (n > 1 ? "count" : "label"))],
  ["a match", () => /(?<count>\d)(?<label>\w)/.exec("1a")?.groups ?? {}],
  ["a descriptor", () => Object.getOwnPropertyDescriptor({ count: 1 }, "count") ?? {}],
  ["an iterator result", () => [1][Symbol.iterator]().next()],
  ["an entry", () => Object.entries({ count: 1 })[0]],
  ["new Object", () => new Object()],
  ["a boxed number", () => Object(5)],
  ["a date", () => new Date(0)],
  ["a map", () => new Map([["count", 1]])],
  ["an error", () => new Error("count")],
  ["fromEntries", () => Object.fromEntries([["count", 5], ["label", "made"]])],
  ["fromEntries, empty", () => Object.fromEntries([])],
];

for (const [name, make] of makers) {
  show(name + ": class readCount", () => s.readCount.call(make()));
  show(name + ": class labelLength", () => s.labelLength.call(make()));
  show(name + ": class bump", () => s.bump.call(make()));
  show(name + ": class readSecret", () => s.readSecret.call(make()));
  show(name + ": literal read", () => literal.read.call(make()));
  show(name + ": literal size", () => literal.size.call(make()));
  show(name + ": literal bump", () => literal.bump.call(make()));
}
show("the subject is untouched", () => s.count + " " + s.label);
show("the literal is untouched", () => literal.count + " " + literal.label);
