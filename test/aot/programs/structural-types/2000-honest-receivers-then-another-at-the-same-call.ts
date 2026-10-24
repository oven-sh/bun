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

class Reordered {
  extra: string = "first";
  label: string = "reordered";
  action: () => number = () => 70;
  count: number = 1000;
  owner: Owner = new Owner();
}
class Fewer {
  count: number = 2000;
}
class OtherKinds {
  count: string = "many";
  label: number = 5;
}

const s = new Subject();

function readOn(receiver: object): number {
  return s.readCount.call(receiver);
}
function plusOneOn(receiver: object): number {
  return s.countPlusOne.call(receiver);
}
function lengthOn(receiver: object): number {
  return s.labelLength.call(receiver);
}
function actOn(receiver: object): number {
  return s.runAction.call(receiver);
}
function bumpOn(receiver: object): number {
  return s.bump.call(receiver);
}
function secretOn(receiver: object): number {
  return s.readSecret.call(receiver);
}

const honest: Subject[] = [];
for (let i = 0; i < 10; i++) honest.push(new Subject());
let total = 0;
for (let i = 0; i < 2000; i++) {
  const receiver = honest[i % 10];
  total += readOn(receiver) + plusOneOn(receiver) + lengthOn(receiver) + actOn(receiver) + secretOn(receiver);
  bumpOn(receiver);
}
show("2000 honest receivers", () => total);

const others: [string, object][] = [
  ["reordered", new Reordered()],
  ["fewer", new Fewer()],
  ["other kinds", new OtherKinds()],
  ["a literal", { count: 3000, label: "literal" }],
  ["an array", [1, 2]],
  ["honest again", new Subject()],
];
for (const [name, receiver] of others) {
  show(name + " read", () => readOn(receiver));
  show(name + " plus one", () => plusOneOn(receiver));
  show(name + " length", () => lengthOn(receiver));
  show(name + " act", () => actOn(receiver));
  show(name + " bump", () => bumpOn(receiver));
  show(name + " secret", () => secretOn(receiver));
  show(name + " read after the bump", () => readOn(receiver));
}

const mixed: object[] = [];
for (let i = 0; i < 2000; i++) mixed.push(i === 1500 ? new Reordered() : i === 1700 ? new OtherKinds() : honest[i % 10]);
let sum = 0;
let strange = "";
for (let i = 0; i < mixed.length; i++) {
  const n = readOn(mixed[i]);
  if (typeof n === "number") sum += n;
  else strange += i + ":" + typeof n + " ";
}
show("two strangers in the middle of a loop: sum", () => sum);
show("two strangers in the middle of a loop: strange", () => strange);
