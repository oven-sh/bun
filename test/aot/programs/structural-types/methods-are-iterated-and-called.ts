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
const numbers: (() => number)[] = [s.readCount, s.countPlusOne, s.labelLength, s.runAction, s.readSecret, s.storeCount, s.bump, s.callsOther];
const strings: (() => string)[] = [s.readLabel, s.ownerName, s.storeLabel, s.kind];

function attempt(f: () => unknown): string {
  try {
    return String(f());
  } catch (error) {
    return "threw";
  }
}

show("for-of", () => {
  const out: string[] = [];
  for (const f of numbers) out.push(attempt(f));
  for (const f of strings) out.push(attempt(f));
  return out.join();
});
show("by index: the array is this", () => {
  const out: string[] = [];
  for (let i = 0; i < numbers.length; i++) out.push(attempt(() => numbers[i]()));
  for (let i = 0; i < strings.length; i++) out.push(attempt(() => strings[i]()));
  return out.join();
});
show("keys of the arrays afterwards", () => Object.keys(numbers).join() + " | " + Object.keys(strings).join());
show("map", () => numbers.map(f => attempt(f)).join());
show("destructured", () => {
  const [first, second] = numbers;
  return attempt(first) + "," + attempt(second);
});
show("spread into a call", () => {
  const pair: [() => number, () => number] = [numbers[0], numbers[1]];
  return ((a: () => number, b: () => number) => attempt(a) + "," + attempt(b))(...pair);
});
show("at", () => attempt(() => numbers.at(0)?.()));
show("pop", () => attempt(() => [...numbers].pop()?.()));
show("values of an object", () => Object.values({ a: s.readCount, b: s.countPlusOne }).map(f => attempt(f)).join());
show("entries of an object", () => Object.entries({ a: s.readCount, b: s.kind }).map(([k, f]) => k + attempt(f)).join());
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
