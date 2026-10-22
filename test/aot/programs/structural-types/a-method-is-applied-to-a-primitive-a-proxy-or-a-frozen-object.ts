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
const log: string[] = [];
const list = [1, 2];
function plain(): number {
  return 0;
}
const proxied = new Proxy(new Subject(), {
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    log.push("set " + String(key));
    return Reflect.set(target, key, value, receiver);
  },
});
const frozen = Object.freeze(new Subject());
const bare: object = Object.create(null);
const inherits: object = Object.create(new Subject());
const receivers: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["a number", 5],
  ["a string", "text"],
  ["true", true],
  ["an array", list],
  ["a function", plain],
  ["a proxy", proxied],
  ["frozen", frozen],
  ["no prototype", bare],
  ["inherits", inherits],
];

for (const [name, receiver] of receivers) {
  show(name + " readCount", () => s.readCount.apply(receiver));
  show(name + " countPlusOne", () => s.countPlusOne.apply(receiver));
  show(name + " readLabel", () => s.readLabel.apply(receiver));
  show(name + " labelLength", () => s.labelLength.apply(receiver));
  show(name + " ownerName", () => s.ownerName.apply(receiver));
  show(name + " runAction", () => s.runAction.apply(receiver));
  show(name + " readSecret", () => s.readSecret.apply(receiver));
  show(name + " storeCount", () => s.storeCount.apply(receiver));
  show(name + " bump", () => s.bump.apply(receiver));
  show(name + " storeLabel", () => s.storeLabel.apply(receiver));
  show(name + " callsOther", () => s.callsOther.apply(receiver));
  show(name + " kind", () => s.kind.apply(receiver));
}
show("log", () => log.join(" "));
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
