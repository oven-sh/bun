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

class Person {
  first: string = "ann";
}

interface Merged {
  extra: number;
  note: string;
  owner: Person;
  list: number[];
  run(): number;
}
class Merged {
  own: number = 1;
  sum(): number {
    return this.own + this.extra;
  }
  heading(): string {
    return this.note + "!";
  }
}

const merged = new Merged();
show("own", () => merged.own);
show("extra", () => merged.extra);
show("extra + 1", () => merged.extra + 1);
show("extra.toFixed", () => merged.extra.toFixed(1));
show("note", () => merged.note);
show("note.length", () => merged.note.length);
show("owner", () => merged.owner);
show("owner.first", () => merged.owner.first);
show("list", () => merged.list);
show("list.length", () => merged.list.length);
show("run", () => merged.run);
show("run()", () => merged.run());
show("sum", () => merged.sum());
show("heading", () => merged.heading());
show("keys", () => Object.keys(merged).join());
show("extra in merged", () => "extra" in merged);

merged.extra = 4;
show("after a store: extra", () => merged.extra);
show("after a store: sum", () => merged.sum());
show("after a store: keys", () => Object.keys(merged).join());

interface OnPrototype {
  legs: number;
  sound: string;
}
class OnPrototype {
  name: string = "p";
  total(): number {
    return this.legs * 2;
  }
}
const before = new OnPrototype();
show("before the prototype has it", () => before.legs);
show("total", () => before.total());
OnPrototype.prototype.legs = 4;
OnPrototype.prototype.sound = "woof";
show("after the prototype has it", () => before.legs);
show("total", () => before.total());
show("sound", () => before.sound.toUpperCase());
show("own legs", () => Object.hasOwn(before, "legs"));
show("keys", () => Object.keys(before).join());
before.legs = 3;
show("an own one hides it", () => before.total());
show("another instance", () => new OnPrototype().total());

function extraOf(m: Merged): number {
  return m.extra;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += extraOf(merged);
show("2000 reads where it is set", () => sum);
show("one where it is not", () => extraOf(new Merged()));
