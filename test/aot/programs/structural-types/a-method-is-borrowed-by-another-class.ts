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

class SameNames {
  label: string = "same names";
  count: number = 1;
  readCount: () => number = Subject.prototype.readCount;
  countPlusOne: () => number = Subject.prototype.countPlusOne;
  readLabel: () => string = Subject.prototype.readLabel;
  labelLength: () => number = Subject.prototype.labelLength;
  bump: () => number = Subject.prototype.bump;
  callsOther: () => number = Subject.prototype.callsOther;
  readSecret: () => number = Subject.prototype.readSecret;
  kind: () => string = Subject.prototype.kind;
}

class OtherKinds {
  count: string = "ten";
  label: number = 5;
  readCount: () => number = Subject.prototype.readCount;
  countPlusOne: () => number = Subject.prototype.countPlusOne;
  readLabel: () => string = Subject.prototype.readLabel;
  labelLength: () => number = Subject.prototype.labelLength;
  bump: () => number = Subject.prototype.bump;
}

class OnPrototype {
  count: number = 2;
}
interface OnPrototype {
  readCount(): number;
  bump(): number;
  callsOther(): number;
}
OnPrototype.prototype.readCount = Subject.prototype.readCount;
OnPrototype.prototype.bump = Subject.prototype.bump;
OnPrototype.prototype.callsOther = Subject.prototype.callsOther;

const same = new SameNames();
show("same names: readCount", () => same.readCount());
show("same names: countPlusOne", () => same.countPlusOne());
show("same names: readLabel", () => same.readLabel());
show("same names: labelLength", () => same.labelLength());
show("same names: bump", () => same.bump());
show("same names: callsOther", () => same.callsOther());
show("same names: readSecret", () => same.readSecret());
show("same names: kind", () => same.kind());
show("same names: count afterwards", () => same.count);

const other = new OtherKinds();
show("other kinds: readCount", () => other.readCount());
show("other kinds: countPlusOne", () => other.countPlusOne());
show("other kinds: readLabel", () => other.readLabel());
show("other kinds: labelLength", () => other.labelLength());
show("other kinds: bump", () => other.bump());
show("other kinds: count afterwards", () => other.count);

const onPrototype = new OnPrototype();
show("on the prototype: readCount", () => onPrototype.readCount());
show("on the prototype: bump", () => onPrototype.bump());
show("on the prototype: callsOther", () => onPrototype.callsOther());
show("on the prototype: keys", () => Object.keys(onPrototype).join());

const s = new Subject();
let total = 0;
for (let i = 0; i < 2000; i++) total += s.readCount();
show("2000 honest calls", () => total);
show("then the borrowed one", () => same.readCount() + " " + other.readCount() + " " + onPrototype.readCount());
show("then the honest one", () => s.readCount());
