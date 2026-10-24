// Only some classes of a hierarchy store to a method, `this.name = ..`: a call through the type of the class above them finds each object's own function or the method of its class.
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

class Source {
  name = "source";
  lift(): string { return "lifted by " + this.name; }
  run(): string { return this.lift(); }
}
class Plain extends Source {
  name = "plain";
}
class Overriding extends Source {
  name = "overriding";
  lift(): string { return "overridden in " + this.name; }
}
class Patched extends Source {
  name = "patched";
  extra = 1;
  constructor(from?: Source) {
    super();
    if (from) this.lift = from.lift;
  }
}
class Deeper extends Patched {
  describe(): string { return "deeper " + this.extra; }
}
class Wide extends Source {
  name = "wide";
  a = 1;
  b = 2;
  c = 3;
  constructor(own: boolean) {
    super();
    if (own) this.lift = () => "its own in " + this.name;
  }
}
class OverridingBelow extends Wide {
  name = "below";
  lift(): string { return "overridden below in " + this.name; }
}

const all: Source[] = [
  new Source(), new Plain(), new Overriding(),
  new Patched(), new Patched(new Overriding()), new Deeper(), new Deeper(new Source()),
  new Wide(false), new Wide(true), new OverridingBelow(false), new OverridingBelow(true),
];
for (let round = 0; round < 3; round++) row("through the class above, round " + round, () => all.map(one => one.run()).join(" | "));
row("called directly", () => all.map(one => one.lift()).join(" | "));
row("own keys", () => all.map(keys).join(" | "));
row("has its own", () => all.map(one => Object.prototype.hasOwnProperty.call(one, "lift")).join());
function hasLift(source: any): boolean { return typeof source?.lift === "function"; }
row("read through any", () => all.map(hasLift).join());
row("read as a value", () => all.map(one => { const lift = one.lift; return lift.call(one); }).join(" | "));
row("the same function as the prototype's", () => all.map(one => one.lift === Object.getPrototypeOf(one).lift).join());
interface Lifts { lift(): string; }
const lifting: Lifts[] = [...all, { lift() { return "a literal"; } }];
row("through an interface", () => lifting.map(one => one.lift()).join(" | "));
