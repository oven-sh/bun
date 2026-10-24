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

function run_readCount({ readCount }: Subject): number {
  return readCount();
}
function run_countPlusOne({ countPlusOne }: Subject): number {
  return countPlusOne();
}
function run_readLabel({ readLabel }: Subject): string {
  return readLabel();
}
function run_labelLength({ labelLength }: Subject): number {
  return labelLength();
}
function run_ownerName({ ownerName }: Subject): string {
  return ownerName();
}
function run_runAction({ runAction }: Subject): number {
  return runAction();
}
function run_readSecret({ readSecret }: Subject): number {
  return readSecret();
}
function run_storeCount({ storeCount }: Subject): number {
  return storeCount();
}
function run_bump({ bump }: Subject): number {
  return bump();
}
function run_storeLabel({ storeLabel }: Subject): string {
  return storeLabel();
}
function run_callsOther({ callsOther }: Subject): number {
  return callsOther();
}
function run_kind({ kind }: Subject): string {
  return kind();
}

const s = new Subject();

show("readCount", () => run_readCount(s));
show("countPlusOne", () => run_countPlusOne(s));
show("readLabel", () => run_readLabel(s));
show("labelLength", () => run_labelLength(s));
show("ownerName", () => run_ownerName(s));
show("runAction", () => run_runAction(s));
show("readSecret", () => run_readSecret(s));
show("storeCount", () => run_storeCount(s));
show("bump", () => run_bump(s));
show("storeLabel", () => run_storeLabel(s));
show("callsOther", () => run_callsOther(s));
show("kind", () => run_kind(s));
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
