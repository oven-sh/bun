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

function pick_readCount(o: Subject): () => number {
  return o.readCount;
}
function pick_countPlusOne(o: Subject): () => number {
  return o.countPlusOne;
}
function pick_readLabel(o: Subject): () => string {
  return o.readLabel;
}
function pick_labelLength(o: Subject): () => number {
  return o.labelLength;
}
function pick_ownerName(o: Subject): () => string {
  return o.ownerName;
}
function pick_runAction(o: Subject): () => number {
  return o.runAction;
}
function pick_readSecret(o: Subject): () => number {
  return o.readSecret;
}
function pick_storeCount(o: Subject): () => number {
  return o.storeCount;
}
function pick_bump(o: Subject): () => number {
  return o.bump;
}
function pick_storeLabel(o: Subject): () => string {
  return o.storeLabel;
}
function pick_callsOther(o: Subject): () => number {
  return o.callsOther;
}
function pick_kind(o: Subject): () => string {
  return o.kind;
}

const s = new Subject();

show("readCount", () => pick_readCount(s)());
show("countPlusOne", () => pick_countPlusOne(s)());
show("readLabel", () => pick_readLabel(s)());
show("labelLength", () => pick_labelLength(s)());
show("ownerName", () => pick_ownerName(s)());
show("runAction", () => pick_runAction(s)());
show("readSecret", () => pick_readSecret(s)());
show("storeCount", () => pick_storeCount(s)());
show("bump", () => pick_bump(s)());
show("storeLabel", () => pick_storeLabel(s)());
show("callsOther", () => pick_callsOther(s)());
show("kind", () => pick_kind(s)());
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
