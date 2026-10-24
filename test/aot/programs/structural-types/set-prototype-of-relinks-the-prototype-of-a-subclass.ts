class Gauge {
  level = 1;
  one(): number {
    return this.level + 1;
  }
  two(): number {
    return this.level + 2;
  }
  three(): number {
    return this.level + 3;
  }
  four(): number {
    return this.level + 4;
  }
  five(): number {
    return this.level + 5;
  }
  get six(): number {
    return this.level + 6;
  }
  get seven(): number {
    return this.level + 7;
  }
  all(): number {
    return this.one() + this.two() + this.three() + this.four() + this.five() + this.six + this.seven;
  }
}

class Fine extends Gauge {
  level = 10;
  superOne(): number {
    return super.one();
  }
  superTwo(): number {
    return super.two();
  }
  superThree(): number {
    return super.three();
  }
  superFour(): number {
    return super.four();
  }
  superFive(): number {
    return super.five();
  }
  superSix(): number {
    return super.six;
  }
  superSeven(): number {
    return super.seven;
  }
}

const before = new Gauge();
const fine = new Fine();

class Other {
  level = -1;
  one(): number {
    return 1000;
  }
  get six(): number {
    return 6000;
  }
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;
}

function takeOne(g: Gauge): number {
  return g.one();
}

function useOne(label: string): void {
  attempt(label + ", an instance made before", () => before.one());
  attempt(label + ", an instance made now", () => new Gauge().one());
  attempt(label + ", plus one", () => before.one() + 1);
  attempt(label + ", typeof the member", () => typeof before.one);
  attempt(label + ", is of its kind", () => typeof before.one === "function");
  attempt(label + ", is undefined", () => before.one === undefined);
  attempt(label + ", a typed function", () => takeOne(before));
  attempt(label + ", a subclass instance", () => fine.one());
  attempt(label + ", through super", () => fine.superOne());
  attempt(label + ", read off the prototype", () => Gauge.prototype.one.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "one") + " " + ("one" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopOne(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.one();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeSix(g: Gauge): number {
  return g.six;
}

function useSix(label: string): void {
  attempt(label + ", an instance made before", () => before.six);
  attempt(label + ", an instance made now", () => new Gauge().six);
  attempt(label + ", plus one", () => before.six + 1);
  attempt(label + ", typeof the member", () => typeof before.six);
  attempt(label + ", is of its kind", () => typeof before.six === "number");
  attempt(label + ", is undefined", () => before.six === undefined);
  attempt(label + ", a typed function", () => takeSix(before));
  attempt(label + ", a subclass instance", () => fine.six);
  attempt(label + ", through super", () => fine.superSix());
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "six") + " " + ("six" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopSix(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.six;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeTwo(g: Gauge): number {
  return g.two();
}

function useTwo(label: string): void {
  attempt(label + ", an instance made before", () => before.two());
  attempt(label + ", an instance made now", () => new Gauge().two());
  attempt(label + ", plus one", () => before.two() + 1);
  attempt(label + ", typeof the member", () => typeof before.two);
  attempt(label + ", is of its kind", () => typeof before.two === "function");
  attempt(label + ", is undefined", () => before.two === undefined);
  attempt(label + ", a typed function", () => takeTwo(before));
  attempt(label + ", a subclass instance", () => fine.two());
  attempt(label + ", through super", () => fine.superTwo());
  attempt(label + ", read off the prototype", () => Gauge.prototype.two.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "two") + " " + ("two" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopTwo(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.two();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeThree(g: Gauge): number {
  return g.three();
}

function useThree(label: string): void {
  attempt(label + ", an instance made before", () => before.three());
  attempt(label + ", an instance made now", () => new Gauge().three());
  attempt(label + ", plus one", () => before.three() + 1);
  attempt(label + ", typeof the member", () => typeof before.three);
  attempt(label + ", is of its kind", () => typeof before.three === "function");
  attempt(label + ", is undefined", () => before.three === undefined);
  attempt(label + ", a typed function", () => takeThree(before));
  attempt(label + ", a subclass instance", () => fine.three());
  attempt(label + ", through super", () => fine.superThree());
  attempt(label + ", read off the prototype", () => Gauge.prototype.three.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "three") + " " + ("three" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopThree(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.three();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useSix("");
  useTwo("");
  useThree("");
}
quiet = false;

useOne("one, untouched");
loopOne("the prototype of the subclass is relinked to another class", () => {
  Object.setPrototypeOf(Fine.prototype, Other.prototype);
});
useOne("the prototype of the subclass is relinked to another class");

useSix("six, untouched");
loopSix("and relinked by Reflect to an object with a getter", () => {
  Reflect.setPrototypeOf(Fine.prototype, {
    get six(): number {
      return 60000;
    },
  });
});
useSix("and relinked by Reflect to an object with a getter");

useTwo("two, untouched");
loopTwo("and relinked to nothing", () => {
  Object.setPrototypeOf(Fine.prototype, null);
});
useTwo("and relinked to nothing");

useThree("three, untouched");
loopThree("and back to its own base", () => {
  Object.setPrototypeOf(Fine.prototype, Gauge.prototype);
});
useThree("and back to its own base");

export {};
