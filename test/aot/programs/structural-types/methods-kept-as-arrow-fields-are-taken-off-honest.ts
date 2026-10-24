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

class Owner {
  first: string = "ann";
}

class Subject {
  count: number = 10;
  label: string = "subject";
  owner: Owner = new Owner();
  action: () => number = () => 7;
  #secret: number = 42;
  readCount = (): number => this.count;
  countPlusOne = (): number => this.count + 1;
  readLabel = (): string => this.label;
  labelLength = (): number => this.label.length;
  ownerName = (): string => this.owner.first;
  runAction = (): number => this.action();
  readSecret = (): number => this.#secret;
  storeCount = (): number => {
    this.count = 99;
    return this.count;
  };
  bump = (): number => ++this.count;
  storeLabel = (): string => {
    this.label = "stored";
    return this.label;
  };
  callsOther = (): number => this.readCount() * 2;
  kind = (): string => typeof this;
}

const s = new Subject();
const { readCount, countPlusOne, readLabel, labelLength, ownerName, runAction, readSecret, storeCount, bump, storeLabel, callsOther, kind } = s;

show("readCount", () => readCount());
show("countPlusOne", () => countPlusOne());
show("readLabel", () => readLabel());
show("labelLength", () => labelLength());
show("ownerName", () => ownerName());
show("runAction", () => runAction());
show("readSecret", () => readSecret());
show("callsOther", () => callsOther());
show("kind", () => kind());
show("bump", () => bump());
show("storeCount", () => storeCount());
show("storeLabel", () => storeLabel());
show("count", () => s.count);
show("label", () => s.label);
show("as an element of an array", () => [s.readCount][0]());
show("through a comma", () => (0, s.readCount)());
show("handed to map", () => [0].map(s.readCount)[0]);
show("handed to map with another this", () => [0].map(s.readCount, { count: 1 })[0]);
show("call with another this", () => s.readCount.call({ count: 1 }));
show("bind to another this", () => s.readCount.bind({ count: 1 })());
show("as a member of another object", () => ({ count: 1, readCount: s.readCount }).readCount());

function run(f: () => number): number {
  return f();
}
let total = 0;
for (let i = 0; i < 2000; i++) total += run(readCount) + run(s.countPlusOne);
show("2000 rounds", () => total);
Promise.resolve(0).then(readCount).then(value => console.log("then: " + typeof value + " " + value));
