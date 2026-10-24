const log: string[] = [];

class Limits {
  static depth = 3;
  static width?: number = 4;
  static title = "limits";
  static twice(): number {
    return Limits.depth * 2;
  }
  static viaThis(): number {
    return this.depth * 2;
  }
  static raise(): number {
    return ++Limits.depth;
  }
}

class Tight extends Limits {}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()) + (log.length ? " [" + log.join(", ") + "]" : ""));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + (log.length ? " [" + log.join(", ") + "]" : ""));
  }
  log.length = 0;
}

function read(): string {
  return Limits.depth + " " + Limits.twice() + " " + Limits.viaThis() + " " + Tight.depth + " " + Tight.viaThis() + " " + Limits.width;
}

function store(value: number): number {
  Limits.depth = value;
  return Limits.depth;
}

function flags(holder: object, name: string): string {
  const d = Object.getOwnPropertyDescriptor(holder, name);
  if (!d) return "nothing";
  return ("value" in d ? "value " + String(d.value) : "accessor") + " " + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += store(i % 5) + Limits.twice() + Tight.viaThis();
store(3);
console.log("2000 honest: " + warm);
attempt("before", read);
attempt("listed", () => Object.keys(Limits).join() + " | " + JSON.stringify({ ...Limits }) + " | " + Object.entries(Limits).join(";") + " | " + flags(Limits, "depth"));
attempt("the subclass lists", () => Object.keys(Tight).join() + "|" + flags(Tight, "depth") + "|" + ("depth" in Tight));

Object.defineProperty(Limits, "depth", { writable: false });
attempt("read-only, read", read);
attempt("read-only, a store", () => store(9));
attempt("read-only, an increment in a static method", () => Limits.raise());
attempt("read-only, a store on the subclass", () => (Tight.depth = 9));
attempt("read-only, flags", () => flags(Limits, "depth"));
Object.defineProperty(Limits, "depth", { writable: true });
attempt("writable again", () => store(5) + " " + read());

Object.defineProperty(Limits, "depth", {
  get() {
    log.push("get");
    return 100;
  },
  set(value: number) {
    log.push("set " + value);
  },
  configurable: true,
});
attempt("an accessor, read", read);
attempt("an accessor, a store", () => store(9));
attempt("an accessor, an increment", () => Limits.raise());
attempt("an accessor, a store on the subclass", () => (Tight.depth = 9) + " own " + Object.hasOwn(Tight, "depth"));
Object.defineProperty(Limits, "depth", { value: 6, writable: true, enumerable: true, configurable: true });
attempt("a value again", read);

delete Limits.width;
attempt("the optional one deleted", () => read() + " | " + Object.keys(Limits).join());
Limits.width = 8;
attempt("stored again", () => read() + " | " + Object.keys(Limits).join());

Reflect.deleteProperty(Limits, "depth");
attempt("depth deleted", () => read() + " | " + Object.keys(Limits).join());
attempt("stored again", () => store(7) + " " + read() + " | " + Object.keys(Limits).join());

Tight.depth = 1;
attempt("the subclass has its own", () => read() + " | " + Object.keys(Tight).join());
Reflect.deleteProperty(Tight, "depth");
attempt("and loses it", read);

Object.freeze(Limits);
attempt("frozen, a store", () => store(9));
attempt("frozen, a static method replaced", () => {
  Limits.twice = () => -1;
  return "stored";
});
attempt("frozen, read", () => read() + " | " + flags(Limits, "depth") + " | " + Object.isFrozen(Limits));
attempt("frozen, a store on the subclass", () => (Tight.depth = 2));

export {};
