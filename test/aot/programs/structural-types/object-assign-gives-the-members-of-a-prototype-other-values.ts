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

function takeFour(g: Gauge): number {
  return g.four();
}

function useFour(label: string): void {
  attempt(label + ", an instance made before", () => before.four());
  attempt(label + ", an instance made now", () => new Gauge().four());
  attempt(label + ", plus one", () => before.four() + 1);
  attempt(label + ", typeof the member", () => typeof before.four);
  attempt(label + ", is of its kind", () => typeof before.four === "function");
  attempt(label + ", is undefined", () => before.four === undefined);
  attempt(label + ", a typed function", () => takeFour(before));
  attempt(label + ", a subclass instance", () => fine.four());
  attempt(label + ", through super", () => fine.superFour());
  attempt(label + ", read off the prototype", () => Gauge.prototype.four.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "four") + " " + ("four" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopFour(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.four();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeFive(g: Gauge): number {
  return g.five();
}

function useFive(label: string): void {
  attempt(label + ", an instance made before", () => before.five());
  attempt(label + ", an instance made now", () => new Gauge().five());
  attempt(label + ", plus one", () => before.five() + 1);
  attempt(label + ", typeof the member", () => typeof before.five);
  attempt(label + ", is of its kind", () => typeof before.five === "function");
  attempt(label + ", is undefined", () => before.five === undefined);
  attempt(label + ", a typed function", () => takeFive(before));
  attempt(label + ", a subclass instance", () => fine.five());
  attempt(label + ", through super", () => fine.superFive());
  attempt(label + ", read off the prototype", () => Gauge.prototype.five.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "five") + " " + ("five" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopFive(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.five();
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

function takeSeven(g: Gauge): number {
  return g.seven;
}

function useSeven(label: string): void {
  attempt(label + ", an instance made before", () => before.seven);
  attempt(label + ", an instance made now", () => new Gauge().seven);
  attempt(label + ", plus one", () => before.seven + 1);
  attempt(label + ", typeof the member", () => typeof before.seven);
  attempt(label + ", is of its kind", () => typeof before.seven === "number");
  attempt(label + ", is undefined", () => before.seven === undefined);
  attempt(label + ", a typed function", () => takeSeven(before));
  attempt(label + ", a subclass instance", () => fine.seven);
  attempt(label + ", through super", () => fine.superSeven());
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "seven") + " " + ("seven" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopSeven(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.seven;
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
  useTwo("");
  useThree("");
  useFour("");
  useFive("");
  useSix("");
  useSeven("");
}
quiet = false;

useOne("one, untouched");
loopOne("one becomes another function of its type", () => {
  Object.assign(Gauge.prototype, { one: function (this: Gauge): number {
      return this.level + 100;
    } });
});
useOne("one becomes another function of its type");

useTwo("two, untouched");
loopTwo("two becomes a function that answers a string", () => {
  Object.assign(Gauge.prototype, { two: () => "text" });
});
useTwo("two becomes a function that answers a string");

useThree("three, untouched");
loopThree("three becomes a number", () => {
  Object.assign(Gauge.prototype, { three: 5 });
});
useThree("three becomes a number");

useFour("four, untouched");
loopFour("four becomes undefined", () => {
  Object.assign(Gauge.prototype, { four: undefined });
});
useFour("four becomes undefined");

useFive("five, untouched");
loopFive("five becomes a class", () => {
  Object.assign(Gauge.prototype, { five: class {} });
});
useFive("five becomes a class");

useSix("six, untouched");
loopSix("the getter six becomes a number", () => {
  Object.assign(Gauge.prototype, { six: 600 });
});
useSix("the getter six becomes a number");

useSeven("seven, untouched");
loopSeven("the getter seven becomes a string", () => {
  Object.assign(Gauge.prototype, { seven: "text" });
});
useSeven("the getter seven becomes a string");

export {};
