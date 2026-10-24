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

show("count in globalThis before", () => "count" in globalThis);
show("readCount on globalThis", () => s.readCount.call(globalThis));
show("kind on globalThis", () => s.kind.call(globalThis));
show("labelLength on globalThis", () => s.labelLength.call(globalThis));
show("readSecret on globalThis", () => s.readSecret.call(globalThis));
show("storeCount on globalThis", () => s.storeCount.call(globalThis));
show("count in globalThis after", () => "count" in globalThis);
show("its value", () => Reflect.get(globalThis, "count"));
show("readCount on globalThis", () => s.readCount.call(globalThis));
show("bump on globalThis", () => s.bump.call(globalThis));
show("its value", () => Reflect.get(globalThis, "count"));
show("storeLabel on globalThis", () => s.storeLabel.call(globalThis));
show("labelLength on globalThis", () => s.labelLength.call(globalThis));
show("callsOther on globalThis", () => s.callsOther.call(globalThis));
show("delete", () => Reflect.deleteProperty(globalThis, "count") && Reflect.deleteProperty(globalThis, "label"));
show("count in globalThis at the end", () => "count" in globalThis);
show("the subject is untouched", () => s.count + " " + s.label);
