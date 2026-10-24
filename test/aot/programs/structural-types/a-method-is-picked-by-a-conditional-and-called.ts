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
const t = new Subject();
t.count = 20;

show("readCount", () => (s.count > 0 ? s.readCount : t.readCount)());
show("countPlusOne", () => (s.count > 0 ? s.countPlusOne : t.countPlusOne)());
show("readLabel", () => (s.count > 0 ? s.readLabel : t.readLabel)());
show("labelLength", () => (s.count > 0 ? s.labelLength : t.labelLength)());
show("ownerName", () => (s.count > 0 ? s.ownerName : t.ownerName)());
show("runAction", () => (s.count > 0 ? s.runAction : t.runAction)());
show("readSecret", () => (s.count > 0 ? s.readSecret : t.readSecret)());
show("storeCount", () => (s.count > 0 ? s.storeCount : t.storeCount)());
show("bump", () => (s.count > 0 ? s.bump : t.bump)());
show("storeLabel", () => (s.count > 0 ? s.storeLabel : t.storeLabel)());
show("callsOther", () => (s.count > 0 ? s.callsOther : t.callsOther)());
show("kind", () => (s.count > 0 ? s.kind : t.kind)());
show("or: readCount", () => (s.readCount || t.readCount)());
show("or: countPlusOne", () => (s.countPlusOne || t.countPlusOne)());
show("or: readLabel", () => (s.readLabel || t.readLabel)());
show("or: labelLength", () => (s.labelLength || t.labelLength)());
show("or: ownerName", () => (s.ownerName || t.ownerName)());
show("or: runAction", () => (s.runAction || t.runAction)());
show("or: readSecret", () => (s.readSecret || t.readSecret)());
show("or: storeCount", () => (s.storeCount || t.storeCount)());
show("or: bump", () => (s.bump || t.bump)());
show("or: storeLabel", () => (s.storeLabel || t.storeLabel)());
show("or: callsOther", () => (s.callsOther || t.callsOther)());
show("or: kind", () => (s.kind || t.kind)());
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
