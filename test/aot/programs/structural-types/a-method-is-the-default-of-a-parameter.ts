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

function run_readCount(f: () => number = s.readCount): number {
  return f();
}
function run_countPlusOne(f: () => number = s.countPlusOne): number {
  return f();
}
function run_readLabel(f: () => string = s.readLabel): string {
  return f();
}
function run_labelLength(f: () => number = s.labelLength): number {
  return f();
}
function run_ownerName(f: () => string = s.ownerName): string {
  return f();
}
function run_runAction(f: () => number = s.runAction): number {
  return f();
}
function run_readSecret(f: () => number = s.readSecret): number {
  return f();
}
function run_storeCount(f: () => number = s.storeCount): number {
  return f();
}
function run_bump(f: () => number = s.bump): number {
  return f();
}
function run_storeLabel(f: () => string = s.storeLabel): string {
  return f();
}
function run_callsOther(f: () => number = s.callsOther): number {
  return f();
}
function run_kind(f: () => string = s.kind): string {
  return f();
}

show("readCount", () => run_readCount());
show("countPlusOne", () => run_countPlusOne());
show("readLabel", () => run_readLabel());
show("labelLength", () => run_labelLength());
show("ownerName", () => run_ownerName());
show("runAction", () => run_runAction());
show("readSecret", () => run_readSecret());
show("storeCount", () => run_storeCount());
show("bump", () => run_bump());
show("storeLabel", () => run_storeLabel());
show("callsOther", () => run_callsOther());
show("kind", () => run_kind());
show("given an arrow: readCount", () => run_readCount(() => s.readCount()));
show("given an arrow: countPlusOne", () => run_countPlusOne(() => s.countPlusOne()));
show("given an arrow: readLabel", () => run_readLabel(() => s.readLabel()));
show("given an arrow: labelLength", () => run_labelLength(() => s.labelLength()));
show("given an arrow: ownerName", () => run_ownerName(() => s.ownerName()));
show("given an arrow: runAction", () => run_runAction(() => s.runAction()));
show("given an arrow: readSecret", () => run_readSecret(() => s.readSecret()));
show("given an arrow: storeCount", () => run_storeCount(() => s.storeCount()));
show("given an arrow: bump", () => run_bump(() => s.bump()));
show("given an arrow: storeLabel", () => run_storeLabel(() => s.storeLabel()));
show("given an arrow: callsOther", () => run_callsOther(() => s.callsOther()));
show("given an arrow: kind", () => run_kind(() => s.kind()));
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
