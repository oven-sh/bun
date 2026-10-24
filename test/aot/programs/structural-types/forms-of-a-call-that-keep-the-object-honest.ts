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
const maybe: Subject | undefined = s.count > 0 ? s : undefined;
const key: "readCount" | "countPlusOne" = s.count > 0 ? "readCount" : "countPlusOne";

class Tagger {
  prefix: string = "tag";
  tag(strings: TemplateStringsArray, value: number): string {
    return this.prefix + strings[0] + value;
  }
  optional?: () => string;
}
const tagger = new Tagger();

show("plain", () => s.readCount());
show("in parentheses", () => (s.readCount)());
show("by a constant name", () => s["readCount"]());
show("by a computed name", () => s[key]());
show("optional chain on the object", () => maybe?.readCount());
show("optional call", () => s.readCount?.());
show("both", () => maybe?.readCount?.());
show("in parentheses with a chain", () => (maybe?.readCount)?.());
show("private name", () => s.readSecret());
show("private name, optional call", () => s.readSecret?.());
show("a store", () => s.storeCount());
show("a method that calls a method", () => s.callsOther());
show("tagged template", () => tagger.tag`-${5}`);
show("tagged template by a name", () => tagger["tag"]`-${6}`);
show("a missing optional method", () => tagger.optional?.());
tagger.optional = function (this: Tagger): string {
  return this.prefix + "!";
};
show("an optional method that is there", () => tagger.optional?.());
show("through a getter that returns the object", () => ({ get it() { return s; } }).it.readCount());
show("through an array element", () => [s][0].readCount());
show("through a call", () => ((): Subject => s)().readCount());
show("through new", () => new Subject().readCount());
show("through await", () => "see below");
show("chained", () => s.owner.first.toUpperCase().toLowerCase());
show("call with itself", () => s.readCount.call(s));
show("apply with itself", () => s.readCount.apply(s));
show("bind to itself", () => s.readCount.bind(s)());
show("Reflect.apply with itself", () => Reflect.apply(s.readCount, s, []));
show("map with itself as this", () => [0].map(s.readCount, s)[0]);

let total = 0;
for (let i = 0; i < 2000; i++) total += s.readCount() + s[key]() + (maybe?.readCount() ?? 0);
show("2000 rounds", () => total);
(async () => {
  console.log("through await: " + (await Promise.resolve(s)).readCount());
})();
