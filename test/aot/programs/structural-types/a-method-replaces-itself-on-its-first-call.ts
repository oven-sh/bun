const log: string[] = [];

class Config {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  value(): number {
    log.push("computed for " + this.name);
    const result = this.name.length * 10;
    this.value = () => result;
    return result;
  }
  shared(): string {
    log.push("shared computed by " + this.name);
    const result = "shared by " + this.name;
    Config.prototype.shared = () => result;
    return result;
  }
  toggled(): string {
    Config.prototype.toggled = Config.prototype.toggled === first ? second : first;
    return "ran as " + (Config.prototype.toggled === first ? "second" : "first");
  }
}

const first = Config.prototype.toggled;
const second = function (this: Config): string {
  Config.prototype.toggled = first;
  return "the second one for " + this.name;
};

function valueOf(c: Config): number {
  return c.value();
}

function sharedOf(c: Config): string {
  return c.shared();
}

const a = new Config("a");
const bb = new Config("bb");

console.log("a: " + valueOf(a) + " " + valueOf(a) + " " + a.value() + " own " + Object.hasOwn(a, "value"));
console.log("bb: " + valueOf(bb) + " " + valueOf(bb) + " " + bb.value() + " own " + Object.hasOwn(bb, "value"));
console.log("log: " + log.join(", "));
log.length = 0;

console.log("shared: " + sharedOf(a) + " | " + sharedOf(bb) + " | " + new Config("ccc").shared());
console.log("log: " + log.join(", "));
log.length = 0;

const many: Config[] = [];
for (let i = 0; i < 2000; i++) many.push(new Config("n" + (i % 7)));
let sum = 0;
for (const each of many) sum += valueOf(each) + valueOf(each);
console.log("2000 instances, two calls each: " + sum + ", computed " + log.length + " times");
log.length = 0;

const toggles: string[] = [];
for (let i = 0; i < 6; i++) toggles.push(a.toggled());
console.log("toggled: " + toggles.join(" | "));

const view: { value?: () => number } = a;
delete view.value;
console.log("forgotten: " + valueOf(a) + " " + valueOf(a) + ", log: " + log.join(", "));

export {};
