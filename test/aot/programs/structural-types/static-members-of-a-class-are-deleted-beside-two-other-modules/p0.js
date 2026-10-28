class Config {
  static one = 1;
  static five() {
    return Config.one + 5;
    return Config.one + Config.two + Config.three + Config.inner.depth;
  }
}
class Special extends Config {
  static own = 8;
}
let quiet = !1;
const log = [];
function text(value) {
  return String(value);
}
function nameOf(error) {
  return error instanceof Error ? "another error" : typeof error;
}
function attempt(label, body) {
  let line;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
}
function takeOne(C) {
  return C.one + 1;
}
function useOne(label) {
  attempt(label + ", used", () => Config.one + 1);
  attempt(label + ", typeof", () => typeof Config.one);
  attempt(label + ", is undefined", () => Config.one === void 0);
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
function loopOne(label, write) {
  let honest = 0, last = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0;i < 2000; i++) {
      if (i === 1000)
        write();
      const value = Config.one + 1;
      if (typeof value === "number" && value === value)
        honest++;
      last = value;
    }
  });
  if (!quiet)
    console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}
function takeFive(C) {
  return C.five();
}
function useFive(label) {
  attempt(label + ", used", () => Config.five());
  attempt(label + ", typeof", () => typeof Config.five);
  attempt(label + ", is undefined", () => Config.five === void 0);
  attempt(label + ", is null or undefined", () => Config.five == null);
  attempt(label + ", a typed function", () => takeFive(Config));
  attempt(label + ", through the subclass", () => Special.five());
  attempt(label + ", a typed function given the subclass", () => takeFive(Special));
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "five") + " " + ("five" in Special));
}
function loopFive(label, write) {
  let honest = 0, last = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0;i < 2000; i++) {
      if (i === 1000)
        write();
      const value = Config.five();
        honest++;
    }
  });
    console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}
function takeSeven(C) {
}
function useSeven(label) {
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0;i < 2000; i++) {
        honest++;
    }
  });
    console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}
function takeTwo(C) {
}
useOne("one, untouched");
loopOne("one is deleted", () => {
  Reflect.deleteProperty(Config, "one");
});
useFive("five, untouched");
loopFive("five is deleted", () => {
  Reflect.deleteProperty(Config, "five");
});
