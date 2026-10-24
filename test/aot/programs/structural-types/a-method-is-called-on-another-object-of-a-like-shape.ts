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

show("another readCount", () => s.readCount.call(another));
show("another countPlusOne", () => s.countPlusOne.call(another));
show("another readLabel", () => s.readLabel.call(another));
show("another labelLength", () => s.labelLength.call(another));
show("another ownerName", () => s.ownerName.call(another));
show("another runAction", () => s.runAction.call(another));
show("another readSecret", () => s.readSecret.call(another));
show("another storeCount", () => s.storeCount.call(another));
show("another bump", () => s.bump.call(another));
show("another storeLabel", () => s.storeLabel.call(another));
show("another callsOther", () => s.callsOther.call(another));
show("another kind", () => s.kind.call(another));
show("sub readCount", () => s.readCount.call(sub));
show("sub countPlusOne", () => s.countPlusOne.call(sub));
show("sub readLabel", () => s.readLabel.call(sub));
show("sub labelLength", () => s.labelLength.call(sub));
show("sub ownerName", () => s.ownerName.call(sub));
show("sub runAction", () => s.runAction.call(sub));
show("sub readSecret", () => s.readSecret.call(sub));
show("sub storeCount", () => s.storeCount.call(sub));
show("sub bump", () => s.bump.call(sub));
show("sub storeLabel", () => s.storeLabel.call(sub));
show("sub callsOther", () => s.callsOther.call(sub));
show("sub kind", () => s.kind.call(sub));
show("unrelated readCount", () => s.readCount.call(unrelated));
show("unrelated countPlusOne", () => s.countPlusOne.call(unrelated));
show("unrelated readLabel", () => s.readLabel.call(unrelated));
show("unrelated labelLength", () => s.labelLength.call(unrelated));
show("unrelated ownerName", () => s.ownerName.call(unrelated));
show("unrelated runAction", () => s.runAction.call(unrelated));
show("unrelated readSecret", () => s.readSecret.call(unrelated));
show("unrelated storeCount", () => s.storeCount.call(unrelated));
show("unrelated bump", () => s.bump.call(unrelated));
show("unrelated storeLabel", () => s.storeLabel.call(unrelated));
show("unrelated callsOther", () => s.callsOther.call(unrelated));
show("unrelated kind", () => s.kind.call(unrelated));
show("sameShape readCount", () => s.readCount.call(sameShape));
show("sameShape countPlusOne", () => s.countPlusOne.call(sameShape));
show("sameShape readLabel", () => s.readLabel.call(sameShape));
show("sameShape labelLength", () => s.labelLength.call(sameShape));
show("sameShape ownerName", () => s.ownerName.call(sameShape));
show("sameShape runAction", () => s.runAction.call(sameShape));
show("sameShape readSecret", () => s.readSecret.call(sameShape));
show("sameShape storeCount", () => s.storeCount.call(sameShape));
show("sameShape bump", () => s.bump.call(sameShape));
show("sameShape storeLabel", () => s.storeLabel.call(sameShape));
show("sameShape callsOther", () => s.callsOther.call(sameShape));
show("sameShape kind", () => s.kind.call(sameShape));
show("otherOrder readCount", () => s.readCount.call(otherOrder));
show("otherOrder countPlusOne", () => s.countPlusOne.call(otherOrder));
show("otherOrder readLabel", () => s.readLabel.call(otherOrder));
show("otherOrder labelLength", () => s.labelLength.call(otherOrder));
show("otherOrder ownerName", () => s.ownerName.call(otherOrder));
show("otherOrder runAction", () => s.runAction.call(otherOrder));
show("otherOrder readSecret", () => s.readSecret.call(otherOrder));
show("otherOrder storeCount", () => s.storeCount.call(otherOrder));
show("otherOrder bump", () => s.bump.call(otherOrder));
show("otherOrder storeLabel", () => s.storeLabel.call(otherOrder));
show("otherOrder callsOther", () => s.callsOther.call(otherOrder));
show("otherOrder kind", () => s.kind.call(otherOrder));
show("wrongKinds readCount", () => s.readCount.call(wrongKinds));
show("wrongKinds countPlusOne", () => s.countPlusOne.call(wrongKinds));
show("wrongKinds readLabel", () => s.readLabel.call(wrongKinds));
show("wrongKinds labelLength", () => s.labelLength.call(wrongKinds));
show("wrongKinds ownerName", () => s.ownerName.call(wrongKinds));
show("wrongKinds runAction", () => s.runAction.call(wrongKinds));
show("wrongKinds readSecret", () => s.readSecret.call(wrongKinds));
show("wrongKinds storeCount", () => s.storeCount.call(wrongKinds));
show("wrongKinds bump", () => s.bump.call(wrongKinds));
show("wrongKinds storeLabel", () => s.storeLabel.call(wrongKinds));
show("wrongKinds callsOther", () => s.callsOther.call(wrongKinds));
show("wrongKinds kind", () => s.kind.call(wrongKinds));
show("partial readCount", () => s.readCount.call(partial));
show("partial countPlusOne", () => s.countPlusOne.call(partial));
show("partial readLabel", () => s.readLabel.call(partial));
show("partial labelLength", () => s.labelLength.call(partial));
show("partial ownerName", () => s.ownerName.call(partial));
show("partial runAction", () => s.runAction.call(partial));
show("partial readSecret", () => s.readSecret.call(partial));
show("partial storeCount", () => s.storeCount.call(partial));
show("partial bump", () => s.bump.call(partial));
show("partial storeLabel", () => s.storeLabel.call(partial));
show("partial callsOther", () => s.callsOther.call(partial));
show("partial kind", () => s.kind.call(partial));
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
