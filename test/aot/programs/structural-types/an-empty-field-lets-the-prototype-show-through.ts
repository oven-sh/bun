function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

class Base {
  constructor() {
    this.init();
  }
  init(): void {}
}

class Derived extends Base {
  count: number = 5;
  label: string = "own";
  watched: number = 1;
  init(): void {
    log.push("count " + typeof this.count + " " + this.count);
    log.push("label " + typeof this.label + " " + this.label);
    log.push("own count " + Object.hasOwn(this, "count"));
    log.push("count in this " + ("count" in this));
    log.push("watched " + this.watched);
    this.watched = 2;
    log.push("own watched " + Object.hasOwn(this, "watched"));
  }
}

function flush(title: string): void {
  for (const entry of log.splice(0)) console.log(title + ": " + entry);
}

new Derived();
flush("nothing on the prototype");

Derived.prototype.count = 77;
Derived.prototype.label = "inherited";
Object.defineProperty(Derived.prototype, "watched", {
  configurable: true,
  get() {
    log.push("the getter ran");
    return -1;
  },
  set(value: number) {
    log.push("the setter got " + value);
  },
});
const second = new Derived();
flush("members on the prototype");
show("afterwards count", () => second.count);
show("afterwards label", () => second.label);
show("afterwards watched", () => second.watched);
show("afterwards keys", () => Object.keys(second).join());
flush("afterwards");

class Sheet {
  declare width: number;
  declare title: string;
  height: number = 2;
  area(): number {
    return this.width * this.height;
  }
}
const sheet = new Sheet();
show("declared, nothing on the prototype", () => sheet.width);
show("area", () => sheet.area());
Sheet.prototype.width = 10;
Sheet.prototype.title = "from the prototype";
show("declared, a number on the prototype", () => sheet.width);
show("area", () => sheet.area());
show("title", () => sheet.title.length);
show("own width", () => Object.hasOwn(sheet, "width"));
sheet.width = 3;
show("an own one", () => sheet.area());
const loose: { width?: number } = sheet;
delete loose.width;
show("deleted again", () => sheet.area());
show("keys", () => Object.keys(sheet).join());

class Plain {
  size: number = 1;
  name: string = "plain";
  double(): number {
    return this.size * 2;
  }
}
const plain = new Plain();
const partly: { size?: number; name?: string } = plain;
let sum = 0;
for (let i = 0; i < 2000; i++) sum += plain.double();
show("2000 honest reads", () => sum);
delete partly.size;
show("deleted: size", () => plain.size);
show("deleted: double", () => plain.double());
show("deleted: in", () => "size" in plain);
show("deleted: keys", () => Object.keys(plain).join());
Plain.prototype.size = 21;
show("the prototype shows through: double", () => plain.double());
show("another instance", () => new Plain().double());
plain.size = 4;
show("set again: double", () => plain.double());
show("set again: keys", () => Object.keys(plain).join());
