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

class Sub extends Subject {
  extra: number = 1;
}
class Unrelated {
  other: number = 5;
}

const s = new Subject();
const another = new Subject();
another.count = 20;
another.label = "another";
const sub = new Sub();
const unrelated = new Unrelated();
const sameShape = { count: 1, label: "literal", owner: new Owner(), action: () => 70 };
const otherOrder = { action: () => 71, owner: new Owner(), label: "reordered", count: 2 };
const wrongKinds = { count: "ten", label: 5, owner: "nobody", action: 3 };
const partial = { count: 3 };
const receivers: [string, object][] = [
  ["another", another],
  ["sub", sub],
  ["unrelated", unrelated],
  ["sameShape", sameShape],
  ["otherOrder", otherOrder],
  ["wrongKinds", wrongKinds],
  ["partial", partial],
];

for (const [name, receiver] of receivers) {
  show(name + " readCount", () => Reflect.apply(s.readCount, receiver, []));
  show(name + " countPlusOne", () => Reflect.apply(s.countPlusOne, receiver, []));
  show(name + " readLabel", () => Reflect.apply(s.readLabel, receiver, []));
  show(name + " labelLength", () => Reflect.apply(s.labelLength, receiver, []));
  show(name + " ownerName", () => Reflect.apply(s.ownerName, receiver, []));
  show(name + " runAction", () => Reflect.apply(s.runAction, receiver, []));
  show(name + " readSecret", () => Reflect.apply(s.readSecret, receiver, []));
  show(name + " storeCount", () => Reflect.apply(s.storeCount, receiver, []));
  show(name + " bump", () => Reflect.apply(s.bump, receiver, []));
  show(name + " storeLabel", () => Reflect.apply(s.storeLabel, receiver, []));
  show(name + " callsOther", () => Reflect.apply(s.callsOther, receiver, []));
  show(name + " kind", () => Reflect.apply(s.kind, receiver, []));
}
show("another afterwards", () => JSON.stringify(another));
show("sub afterwards", () => JSON.stringify(sub));
show("unrelated afterwards", () => JSON.stringify(unrelated));
show("sameShape afterwards", () => JSON.stringify(sameShape));
show("otherOrder afterwards", () => JSON.stringify(otherOrder));
show("wrongKinds afterwards", () => JSON.stringify(wrongKinds));
show("partial afterwards", () => JSON.stringify(partial));
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
