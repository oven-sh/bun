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
const t = new Subject();
t.count = 20;

function honestOne(): number {
  return s.countPlusOne();
}
function honestTwo(): number {
  return t.countPlusOne();
}
function honestThree(o: Subject): number {
  return o.countPlusOne() + o.callsOther();
}
function honestFour(list: Subject[]): number {
  let sum = 0;
  for (const o of list) sum += o.countPlusOne();
  return sum;
}
function drops(o: Subject): number {
  const f = o.countPlusOne;
  return f();
}
function dropsByCall(o: Subject, receiver: { count: number }): number {
  return o.countPlusOne.call(receiver);
}
function dropsByName(o: Subject, name: "countPlusOne" | "callsOther"): number {
  const f = o[name];
  return f();
}
function keepsByName(o: Subject, name: "countPlusOne" | "callsOther"): number {
  return o[name]();
}

function round(title: string): void {
  show(title + " honest one", honestOne);
  show(title + " honest two", honestTwo);
  show(title + " honest three", () => honestThree(s));
  show(title + " honest four", () => honestFour([s, t]));
  show(title + " by name, kept", () => keepsByName(s, "countPlusOne") + keepsByName(t, "callsOther"));
}

round("before");
show("drops", () => drops(s));
show("drops by call, a look-alike", () => dropsByCall(s, { count: 500 }));
show("drops by call, another subject", () => dropsByCall(s, t));
show("drops by name", () => dropsByName(s, "countPlusOne"));
show("drops by name", () => dropsByName(s, "callsOther"));
round("after");

let total = 0;
for (let i = 0; i < 2000; i++) total += honestThree(i % 2 === 0 ? s : t);
show("2000 honest calls", () => total);
show("drops", () => drops(s));
show("drops by call, a look-alike", () => dropsByCall(s, { count: 500 }));
round("at the end");
