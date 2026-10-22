class Config {
  static one = 1;
  static two = 2;
  static three = 3;
  static word = "word";
  static inner = { depth: 4 };
  static five(): number {
    return Config.one + 5;
  }
  static six(): number {
    return 6;
  }
  static get seven(): number {
    return Config.two + 7;
  }
  static sum(): number {
    return Config.one + Config.two + Config.three + Config.word.length + Config.inner.depth + Config.five() + Config.six() + Config.seven;
  }
  fromAnInstance(): number {
    return Config.one + Config.two + Config.three + Config.inner.depth;
  }
}

class Special extends Config {
  static own = 8;
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

function takeOne(C: typeof Config): number {
  return C.one + 1;
}

function useOne(label: string): void {
  attempt(label + ", used", () => Config.one + 1);
  attempt(label + ", typeof", () => typeof Config.one);
  attempt(label + ", is undefined", () => Config.one === undefined);
  attempt(label + ", is null or undefined", () => Config.one == null);
  attempt(label + ", a typed function", () => takeOne(Config));
  attempt(label + ", through the subclass", () => Special.one + 1);
  attempt(label + ", a typed function given the subclass", () => takeOne(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "one") + " " + ("one" in Special));
}

function loopOne(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.one + 1;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeTwo(C: typeof Config): number {
  return C.two + 1;
}

function useTwo(label: string): void {
  attempt(label + ", used", () => Config.two + 1);
  attempt(label + ", typeof", () => typeof Config.two);
  attempt(label + ", is undefined", () => Config.two === undefined);
  attempt(label + ", is null or undefined", () => Config.two == null);
  attempt(label + ", a typed function", () => takeTwo(Config));
  attempt(label + ", through the subclass", () => Special.two + 1);
  attempt(label + ", a typed function given the subclass", () => takeTwo(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "two") + " " + ("two" in Special));
}

function loopTwo(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.two + 1;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeThree(C: typeof Config): number {
  return C.three + 1;
}

function useThree(label: string): void {
  attempt(label + ", used", () => Config.three + 1);
  attempt(label + ", typeof", () => typeof Config.three);
  attempt(label + ", is undefined", () => Config.three === undefined);
  attempt(label + ", is null or undefined", () => Config.three == null);
  attempt(label + ", a typed function", () => takeThree(Config));
  attempt(label + ", through the subclass", () => Special.three + 1);
  attempt(label + ", a typed function given the subclass", () => takeThree(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "three") + " " + ("three" in Special));
}

function loopThree(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.three + 1;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeInner(C: typeof Config): number {
  return C.inner.depth;
}

function useInner(label: string): void {
  attempt(label + ", used", () => Config.inner.depth);
  attempt(label + ", typeof", () => typeof Config.inner);
  attempt(label + ", is undefined", () => Config.inner === undefined);
  attempt(label + ", is null or undefined", () => Config.inner == null);
  attempt(label + ", a typed function", () => takeInner(Config));
  attempt(label + ", through the subclass", () => Special.inner.depth);
  attempt(label + ", a typed function given the subclass", () => takeInner(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "inner") + " " + ("inner" in Special));
}

function loopInner(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.inner.depth;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

function takeWord(C: typeof Config): number {
  return C.word.length;
}

function useWord(label: string): void {
  attempt(label + ", used", () => Config.word.length);
  attempt(label + ", typeof", () => typeof Config.word);
  attempt(label + ", is undefined", () => Config.word === undefined);
  attempt(label + ", is null or undefined", () => Config.word == null);
  attempt(label + ", a typed function", () => takeWord(Config));
  attempt(label + ", through the subclass", () => Special.word.length);
  attempt(label + ", a typed function given the subclass", () => takeWord(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "word") + " " + ("word" in Special));
}

function loopWord(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.word.length;
      if (typeof value === "number" && value === value) honest++;
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
  useInner("");
  useWord("");
}
quiet = false;

useOne("one, untouched");
loopOne("one is made read-only, then stored to", () => {
  Object.defineProperty(Config, "one", { writable: false });
  Config.one = 100;
});
useOne("one is made read-only, then stored to");

useTwo("two, untouched");
loopTwo("the class is sealed, then two is stored to", () => {
  Object.seal(Config);
  Config.two = 200;
});
useTwo("the class is sealed, then two is stored to");

useThree("three, untouched");
loopThree("the class is frozen, then three is stored to", () => {
  Object.freeze(Config);
  Config.three = 300;
});
useThree("the class is frozen, then three is stored to");

useInner("inner, untouched");
loopInner("a member of a member of the frozen class is stored to", () => {
  Config.inner.depth = 400;
});
useInner("a member of a member of the frozen class is stored to");

useWord("word, untouched");
loopWord("the subclass stores its own word over the frozen one", () => {
  Special.word = "special";
});
useWord("the subclass stores its own word over the frozen one");

export {};
