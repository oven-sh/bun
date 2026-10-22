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

function run<T>(f: () => T): T {
  return f();
}
function runTwice(f: () => number): number {
  return f() + f();
}

const s = new Subject();

show("readCount", () => run(s.readCount));
show("countPlusOne", () => run(s.countPlusOne));
show("readLabel", () => run(s.readLabel));
show("labelLength", () => run(s.labelLength));
show("ownerName", () => run(s.ownerName));
show("runAction", () => run(s.runAction));
show("readSecret", () => run(s.readSecret));
show("storeCount", () => run(s.storeCount));
show("bump", () => run(s.bump));
show("storeLabel", () => run(s.storeLabel));
show("callsOther", () => run(s.callsOther));
show("kind", () => run(s.kind));
show("twice: readCount", () => runTwice(s.readCount));
show("twice: an arrow around it", () => runTwice(() => s.readCount()));
show("twice: bound", () => runTwice(s.readCount.bind(s)));
let total = 0;
for (let i = 0; i < 2000; i++) total += runTwice(() => s.readCount());
show("2000 honest calls", () => total);
show("then the bare method", () => runTwice(s.readCount));
show("then an honest one", () => runTwice(() => s.readCount()));
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
