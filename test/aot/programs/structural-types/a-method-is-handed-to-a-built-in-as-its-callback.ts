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

show("map: readCount", () => [0].map(s.readCount)[0]);
show("map: countPlusOne", () => [0].map(s.countPlusOne)[0]);
show("map: readLabel", () => [0].map(s.readLabel)[0]);
show("map: labelLength", () => [0].map(s.labelLength)[0]);
show("map: ownerName", () => [0].map(s.ownerName)[0]);
show("map: runAction", () => [0].map(s.runAction)[0]);
show("map: readSecret", () => [0].map(s.readSecret)[0]);
show("map: storeCount", () => [0].map(s.storeCount)[0]);
show("map: bump", () => [0].map(s.bump)[0]);
show("map: storeLabel", () => [0].map(s.storeLabel)[0]);
show("map: callsOther", () => [0].map(s.callsOther)[0]);
show("map: kind", () => [0].map(s.kind)[0]);
show("forEach: bump", () => [0, 0].forEach(s.bump));
show("filter: readCount", () => [1, 2].filter(s.readCount).length);
show("some: readCount", () => [1, 2].some(s.readCount));
show("find: readLabel", () => [1, 2].find(s.readLabel));
show("flatMap: readCount", () => [1].flatMap(s.readCount).length);
show("Array.from: readCount", () => Array.from([1], s.readCount)[0]);
show("Array.from a length: kind", () => Array.from({ length: 1 }, s.kind)[0]);
show("sort: readCount", () => [2, 1].sort(s.readCount).join());
show("reduce: readCount", () => [1, 2].reduce(s.readCount));
show("replace: readLabel", () => "abc".replace("b", s.readLabel));
show("replace: kind", () => "abc".replace("b", s.kind));
show("set forEach: kind", () => {
  let seen = "";
  const note = s.kind;
  new Set([1]).forEach(() => {
    seen += note();
  });
  return seen;
});
show("typed array map: readCount", () => new Float64Array(1).map(s.readCount)[0]);
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
