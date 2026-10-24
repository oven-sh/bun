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
let makesNumber: () => number;
let makesString: () => string;

show("readCount", () => (makesNumber = s.readCount)());
show("countPlusOne", () => (makesNumber = s.countPlusOne)());
show("readLabel", () => (makesString = s.readLabel)());
show("labelLength", () => (makesNumber = s.labelLength)());
show("ownerName", () => (makesString = s.ownerName)());
show("runAction", () => (makesNumber = s.runAction)());
show("readSecret", () => (makesNumber = s.readSecret)());
show("storeCount", () => (makesNumber = s.storeCount)());
show("bump", () => (makesNumber = s.bump)());
show("storeLabel", () => (makesString = s.storeLabel)());
show("callsOther", () => (makesNumber = s.callsOther)());
show("kind", () => (makesString = s.kind)());
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
