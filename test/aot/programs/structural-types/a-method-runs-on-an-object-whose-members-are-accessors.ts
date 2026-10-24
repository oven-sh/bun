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
const log: string[] = [];

function watched(): object {
  let count = 1;
  let label = "watched";
  return {
    get count(): number {
      log.push("get count");
      return count;
    },
    set count(value: number) {
      log.push("set count " + value);
      count = value;
    },
    get label(): string {
      log.push("get label");
      return label;
    },
    set label(value: string) {
      log.push("set label " + value);
      label = value;
    },
    get owner(): Owner {
      log.push("get owner");
      return new Owner();
    },
    get action(): () => number {
      log.push("get action");
      return () => 70;
    },
    get readCount(): () => number {
      log.push("get readCount");
      return () => 700;
    },
  };
}
class OnPrototype {
  get count(): number {
    log.push("prototype get count");
    return 2;
  }
  get label(): string {
    log.push("prototype get label");
    return "on the prototype";
  }
}
const throwing = {
  get count(): number {
    throw new RangeError("no count");
  },
  get label(): string {
    throw new RangeError("no label");
  },
};
const changing = {
  reads: 0,
  get count(): number | string {
    return this.reads++ % 2 === 0 ? 1 : "one";
  },
};

function all(title: string, make: () => object): void {
  const uses: [string, (receiver: object) => unknown][] = [
    ["readCount", r => s.readCount.call(r)],
    ["countPlusOne", r => s.countPlusOne.call(r)],
    ["labelLength", r => s.labelLength.call(r)],
    ["ownerName", r => s.ownerName.call(r)],
    ["runAction", r => s.runAction.call(r)],
    ["storeCount", r => s.storeCount.call(r)],
    ["bump", r => s.bump.call(r)],
    ["storeLabel", r => s.storeLabel.call(r)],
    ["callsOther", r => s.callsOther.call(r)],
  ];
  for (const [name, use] of uses) {
    const receiver = make();
    show(title + " " + name, () => use(receiver));
    console.log("  " + log.splice(0).join(", "));
  }
}

all("own accessors", watched);
all("accessors on the prototype", () => new OnPrototype());
all("accessors that throw", () => throwing);
all("an accessor that changes its mind", () => changing);
