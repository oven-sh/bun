const log: string[] = [];

class Settings {
  static limit = 10;
  static format: (n: number) => string = n => "<" + n + ">";
  static readonly version: string = "one";
  static get doubled(): number {
    log.push("get doubled");
    return Settings.limit * 2;
  }
  static check(n: number): string {
    return n < Settings.limit ? Settings.format(n) : "over " + this.limit;
  }
  allowed(n: number): boolean {
    return n < Settings.limit;
  }
}

class Strict extends Settings {}

function checkOf(n: number): string {
  return Settings.check(n) + " " + Settings.format(n) + " " + Settings.doubled + " " + Settings.version;
}

function through(c: typeof Settings, n: number): string {
  return c.check(n) + " " + c.format(n) + " " + c.doubled + " " + c.limit;
}

const instance = new Settings();

function round(label: string): void {
  console.log(label + ": " + checkOf(5) + " | " + through(Settings, 5) + " | " + through(Strict, 5) + " | " + instance.allowed(5) + " [" + log.length + " getter runs]");
  log.length = 0;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += checkOf(i % 20).length + through(Strict, i % 20).length;
log.length = 0;
console.log("2000 honest: " + warm);
round("before");

Settings.limit = 3;
round("the limit stored to");

Settings.limit = 2.5;
round("a fraction");

const format = Settings.format;
Settings.format = n => "[" + n + "]";
Settings.limit = 10;
round("the function field replaced");

Settings.format = String;
round("by a built-in");

Strict.limit = 1;
round("the subclass gets a limit of its own");

Strict.format = () => "strict";
round("and a format of its own");

Reflect.deleteProperty(Strict, "limit");
Reflect.deleteProperty(Strict, "format");
Settings.format = format;
round("restored");

Object.defineProperty(Settings, "doubled", { value: -1, configurable: true });
round("the static getter covered by a value");

Object.defineProperty(Settings, "doubled", {
  get() {
    log.push("another getter");
    return 1000;
  },
  configurable: true,
});
round("by another getter");

const loose: { version: string } = Settings;
loose.version = "two";
round("the readonly member stored through a view");

export {};
