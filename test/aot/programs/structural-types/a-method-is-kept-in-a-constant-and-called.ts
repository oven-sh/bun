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
const readCount = s.readCount;
const countPlusOne = s.countPlusOne;
const readLabel = s.readLabel;
const labelLength = s.labelLength;
const ownerName = s.ownerName;
const runAction = s.runAction;
const readSecret = s.readSecret;
const storeCount = s.storeCount;
const bump = s.bump;
const storeLabel = s.storeLabel;
const callsOther = s.callsOther;
const kind = s.kind;

show("readCount", () => readCount());
show("countPlusOne", () => countPlusOne());
show("readLabel", () => readLabel());
show("labelLength", () => labelLength());
show("ownerName", () => ownerName());
show("runAction", () => runAction());
show("readSecret", () => readSecret());
show("storeCount", () => storeCount());
show("bump", () => bump());
show("storeLabel", () => storeLabel());
show("callsOther", () => callsOther());
show("kind", () => kind());
show("the object is untouched: count", () => s.count);
show("the object is untouched: label", () => s.label);
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
show("on the object: kind", () => s.kind());
