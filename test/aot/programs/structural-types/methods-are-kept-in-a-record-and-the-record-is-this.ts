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
const table = {
  readCount: s.readCount,
  countPlusOne: s.countPlusOne,
  readLabel: s.readLabel,
  labelLength: s.labelLength,
  ownerName: s.ownerName,
  runAction: s.runAction,
  readSecret: s.readSecret,
  storeCount: s.storeCount,
  bump: s.bump,
  storeLabel: s.storeLabel,
  callsOther: s.callsOther,
  kind: s.kind,
};

show("readCount", () => table.readCount());
show("countPlusOne", () => table.countPlusOne());
show("readLabel", () => table.readLabel());
show("labelLength", () => table.labelLength());
show("ownerName", () => table.ownerName());
show("runAction", () => table.runAction());
show("readSecret", () => table.readSecret());
show("storeCount", () => table.storeCount());
show("bump", () => table.bump());
show("storeLabel", () => table.storeLabel());
show("callsOther", () => table.callsOther());
show("kind", () => table.kind());
show("keys of the table", () => Object.keys(table).join());
const withFields = { count: 5, label: "table", readCount: s.readCount, readLabel: s.readLabel, bump: s.bump, callsOther: s.callsOther, labelLength: s.labelLength };
show("a table with fields: readCount", () => withFields.readCount());
show("a table with fields: readLabel", () => withFields.readLabel());
show("a table with fields: labelLength", () => withFields.labelLength());
show("a table with fields: bump", () => withFields.bump());
show("a table with fields: callsOther", () => withFields.callsOther());
show("a table with fields: count", () => withFields.count);
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
