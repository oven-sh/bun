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

const proto = Subject.prototype;

show("readCount", () => proto.readCount());
show("countPlusOne", () => proto.countPlusOne());
show("readLabel", () => proto.readLabel());
show("labelLength", () => proto.labelLength());
show("ownerName", () => proto.ownerName());
show("runAction", () => proto.runAction());
show("readSecret", () => proto.readSecret());
show("callsOther", () => proto.callsOther());
show("kind", () => proto.kind());
show("keys before", () => Object.keys(proto).join());
show("storeCount", () => proto.storeCount());
show("storeLabel", () => proto.storeLabel());
show("keys after", () => Object.keys(proto).join());
show("readCount after the store", () => proto.readCount());

const fresh = new Subject();
show("a new instance has its own", () => fresh.readCount() + " " + fresh.readLabel());
const loose: { count?: number; label?: string } = fresh;
delete loose.count;
delete loose.label;
show("without its own it sees the prototype's", () => fresh.readCount() + " " + fresh.readLabel());
show("bump makes an own one again", () => fresh.bump());
show("own count", () => Object.hasOwn(fresh, "count"));
show("the prototype's count", () => proto.count);

const made: Subject = Object.create(Subject.prototype);
show("made from the prototype: readCount", () => made.readCount());
show("made from the prototype: readSecret", () => made.readSecret());
show("made from the prototype: runAction", () => made.runAction());
show("made from the prototype: keys", () => Object.keys(made).join());
show("made from the prototype: bump", () => made.bump());
show("made from the prototype: keys", () => Object.keys(made).join());
