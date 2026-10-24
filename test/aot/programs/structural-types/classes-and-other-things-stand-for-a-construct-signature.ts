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

class Thing {
  static kind: string = "thing";
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  twice(): number {
    return this.n * 2;
  }
}

class SubThing extends Thing {
  static kind: string = "sub";
  extra: string = "extra";
  twice(): number {
    return this.n * 20;
  }
}

class Unrelated {
  static kind: string = "unrelated";
  before: string = "first";
  n: number;
  constructor(n: number) {
    this.n = n + 0.5;
  }
  twice(): number {
    return -this.n;
  }
}

const standIn: Thing = { n: 99, twice: () => -99 };
class Returns {
  static kind: string = "returns";
  n: number = 0;
  constructor(n: number) {
    return standIn;
  }
  twice(): number {
    return 0;
  }
}

interface ThingMaker {
  new (n: number): Thing;
  kind: string;
}

const log: string[] = [];
const proxied: ThingMaker = new Proxy(Thing, {
  construct(target, args, newTarget) {
    log.push("construct " + args.length);
    return Reflect.construct(target, [7], newTarget);
  },
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
});
const bound: ThingMaker = Thing.bind(null);
const boundWithArgument = Thing.bind(null, 5);

function make(M: ThingMaker, n: number): Thing {
  return new M(n);
}
function kindOf(M: ThingMaker): string {
  return M.kind;
}

const makers: [string, ThingMaker][] = [
  ["Thing", Thing],
  ["SubThing", SubThing],
  ["Unrelated", Unrelated],
  ["Returns", Returns],
  ["proxied", proxied],
  ["bound", bound],
];

for (const [label, M] of makers) {
  show(label + " kind", () => kindOf(M));
  show(label + " made", () => make(M, 3));
  show(label + " n", () => make(M, 3).n);
  show(label + " twice", () => make(M, 3).twice());
  show(label + " instanceof Thing", () => make(M, 3) instanceof Thing);
  show(label + " instanceof M", () => make(M, 3) instanceof M);
  show(label + " constructor", () => make(M, 3).constructor.name);
  show(label + " name", () => M.name);
  show(label + " length", () => M.length);
  show(label + " has a prototype", () => "prototype" in M);
  show(label + " keys of what is made", () => Object.keys(make(M, 3)).join());
}
show("log", () => log.join());
show("bound with an argument: n", () => new boundWithArgument().n);
show("bound with an argument: instanceof Thing", () => new boundWithArgument() instanceof Thing);
show("bound with an argument: length", () => boundWithArgument.length);
show("bound with an argument: name", () => boundWithArgument.name);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += make(Thing, 1).n;
show("2000 honest constructions", () => sum);
show("then the unrelated class", () => make(Unrelated, 1).n);
show("then the one that returns a stand-in", () => make(Returns, 1).n);
show("then the honest one", () => make(Thing, 1).n);
show("new Returns directly", () => new Returns(1).n);
show("new Returns directly is the stand-in", () => new Returns(1) === standIn);
