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

show("readCount", () => (0, s.readCount)());
show("countPlusOne", () => (0, s.countPlusOne)());
show("readLabel", () => (0, s.readLabel)());
show("labelLength", () => (0, s.labelLength)());
show("ownerName", () => (0, s.ownerName)());
show("runAction", () => (0, s.runAction)());
show("readSecret", () => (0, s.readSecret)());
show("storeCount", () => (0, s.storeCount)());
show("bump", () => (0, s.bump)());
show("storeLabel", () => (0, s.storeLabel)());
show("callsOther", () => (0, s.callsOther)());
show("kind", () => (0, s.kind)());
show("in parentheses only: readCount", () => (s.readCount)());
show("in parentheses only: countPlusOne", () => (s.countPlusOne)());
show("in parentheses only: readLabel", () => (s.readLabel)());
show("in parentheses only: labelLength", () => (s.labelLength)());
show("in parentheses only: ownerName", () => (s.ownerName)());
show("in parentheses only: runAction", () => (s.runAction)());
show("in parentheses only: readSecret", () => (s.readSecret)());
show("in parentheses only: storeCount", () => (s.storeCount)());
show("in parentheses only: bump", () => (s.bump)());
show("in parentheses only: storeLabel", () => (s.storeLabel)());
show("in parentheses only: callsOther", () => (s.callsOther)());
show("in parentheses only: kind", () => (s.kind)());
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
