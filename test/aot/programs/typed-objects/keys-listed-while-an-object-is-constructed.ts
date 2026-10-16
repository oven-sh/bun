// The fields of a class come into being one by one, each when its initializer has run, and those of a class that extends another when `super()` has returned. Whoever lists the keys of the object in between finds those that are there by then.
const seen: string[] = [];
const look = (label: string, object: object): number => {
  seen.push(label + ": " + Object.keys(object).join() + " " + JSON.stringify(object) + " " + Object.entries(object).length + " " + Object.getOwnPropertyNames(object).join());
  return seen.length;
};
class Fields {
  a = 1;
  b = look("b of Fields", this);
  c = "c";
  d = Object.keys(this).join("");
  e?: string;
  f = look("f of Fields", this);
}
class Base {
  first = 1;
  constructor() {
    look("Base", this);
    this.hook();
  }
  hook(): void {}
}
class Derived extends Base {
  second = 2;
  third: number;
  early = "";
  constructor() {
    super();
    look("Derived", this);
    this.third = 3;
  }
  override hook(): void {
    look("hook", this);
  }
}
class Further extends Derived {
  fourth = look("fourth of Further", this);
  fifth = 5;
}
class Handlers {
  count = 0;
  up = () => { look("up", this); return ++this.count; };
  down = () => --this.count;
  started = this.up();
  last = "last";
}
class Parameters extends Base {
  constructor(public x: number, readonly y: string) {
    super();
    look("Parameters", this);
  }
  z = look("z of Parameters", this);
}
class Creates {
  first = 1;
  late?: number;
  step(): number { return 0; }
  constructor(sets: boolean) {
    if (sets) {
      delete this.late;
      this.late = 2;
      this.step = () => 3;
    }
  }
}
class AfterCreates extends Creates {
  last = 4;
}
class Adds extends Base {
  own = 1;
  override hook(): void {
    (this as any).extra = "extra";
  }
}
class Throws extends Base {
  value = 1;
  override hook(): void {
    kept = this;
    throw new RangeError("in the hook");
  }
}
let kept: object | undefined;
const made: object[] = [new Fields(), new Derived(), new Further(), new Handlers(), new Parameters(1, "y"), new AfterCreates(false), new AfterCreates(true), new Adds()];
try {
  new Throws();
} catch (error) {
  look("left half made by " + (error as Error).name, kept!);
}
console.log(seen.join("\n"));
for (const object of made) {
  const inherited: string[] = [];
  for (const key in object) inherited.push(key);
  console.log(object.constructor.name, Object.keys(object).join(), JSON.stringify(object), inherited.join(), Object.keys({ ...object }).join());
}
for (let i = 0; i < 300; i++) {
  seen.length = 0;
  new Further();
  new Fields();
}
console.log(seen.join("\n"));
