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

show("readCount", () => [s.readCount][0]());
show("countPlusOne", () => [s.countPlusOne][0]());
show("readLabel", () => [s.readLabel][0]());
show("labelLength", () => [s.labelLength][0]());
show("ownerName", () => [s.ownerName][0]());
show("runAction", () => [s.runAction][0]());
show("readSecret", () => [s.readSecret][0]());
show("storeCount", () => [s.storeCount][0]());
show("bump", () => [s.bump][0]());
show("storeLabel", () => [s.storeLabel][0]());
show("callsOther", () => [s.callsOther][0]());
show("kind", () => [s.kind][0]());
const list = [s.storeCount, s.storeLabel, s.readCount, s.readLabel];
show("the array is this: storeCount", () => list[0]());
show("the array is this: storeLabel", () => list[1]());
show("the array is this: readCount", () => list[2]());
show("the array is this: readLabel", () => list[3]());
show("keys of the array", () => Object.keys(list).join());
show("length of the array", () => list.length);
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
