function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Adder {
  (n: number): number;
}
class Adder {
  step: number = 1;
}

interface Maker {
  new (n: number): { made: number };
}
class Maker {
  id: number = 2;
}

interface Routine extends Function {}
class Routine {
  id: number = 3;
}

function apply(f: (n: number) => number, n: number): number {
  return f(n);
}

function make(maker: new (n: number) => { made: number }, n: number): number {
  return new maker(n).made;
}

class Real {
  made: number;
  constructor(n: number) {
    this.made = n;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += apply(n => n + 1, i) + make(Real, i);
show("2000 honest rounds", () => warm);

const adder = new Adder();
show("typeof", () => typeof adder);
show("called", () => adder(1));
show("given to a typed function", () => apply(adder, 1));
show("as a callback", () => [1, 2].map(adder));
show("its own member", () => adder.step);
show("keys", () => Object.keys(adder));

const maker = new Maker();
show("constructed", () => new maker(1));
show("given to a typed function", () => make(maker, 1));

const routine = new Routine();
show("call", () => routine.call(undefined));
show("apply", () => routine.apply(undefined, []));
show("bind", () => routine.bind(undefined));
show("its name", () => routine.name);
show("its length", () => routine.length);
show("its length plus one", () => routine.length + 1);
show("its prototype", () => routine.prototype);
show("toString", () => routine.toString());
show("instanceof Function", () => routine instanceof Function);
show("the real call on it", () => Function.prototype.call.call(routine, undefined));
show("honest again", () => [apply(n => n + 1, 1), make(Real, 2)]);
