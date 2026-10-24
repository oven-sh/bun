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
const numbers = new Map<string, () => number>();
const strings = new Map<string, () => string>();
numbers.set("readCount", s.readCount);
numbers.set("countPlusOne", s.countPlusOne);
strings.set("readLabel", s.readLabel);
numbers.set("labelLength", s.labelLength);
strings.set("ownerName", s.ownerName);
numbers.set("runAction", s.runAction);
numbers.set("readSecret", s.readSecret);
numbers.set("storeCount", s.storeCount);
numbers.set("bump", s.bump);
strings.set("storeLabel", s.storeLabel);
numbers.set("callsOther", s.callsOther);
strings.set("kind", s.kind);

show("readCount", () => numbers.get("readCount")?.());
show("countPlusOne", () => numbers.get("countPlusOne")?.());
show("readLabel", () => strings.get("readLabel")?.());
show("labelLength", () => numbers.get("labelLength")?.());
show("ownerName", () => strings.get("ownerName")?.());
show("runAction", () => numbers.get("runAction")?.());
show("readSecret", () => numbers.get("readSecret")?.());
show("storeCount", () => numbers.get("storeCount")?.());
show("bump", () => numbers.get("bump")?.());
show("storeLabel", () => strings.get("storeLabel")?.());
show("callsOther", () => numbers.get("callsOther")?.());
show("kind", () => strings.get("kind")?.());
show("for-of over the map", () => {
  const out: string[] = [];
  for (const [name, f] of numbers) {
    try {
      out.push(name + "=" + f());
    } catch (error) {
      out.push(name + " threw");
    }
  }
  return out.join(" ");
});
show("forEach over the map", () => {
  const out: string[] = [];
  strings.forEach((f, name) => {
    try {
      out.push(name + "=" + f());
    } catch (error) {
      out.push(name + " threw");
    }
  });
  return out.join(" ");
});
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
