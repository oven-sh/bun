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

declare class MissingBox {
  value: number;
  constructor(value: number);
  get(): number;
  static make(): MissingBox;
  static count: number;
}

const log: string[] = [];
function noted(n: number): number {
  log.push("ran " + n);
  return n;
}

function valueOf(box: MissingBox): number {
  return box.value;
}

function getOf(box: MissingBox): number {
  return box.get();
}

function isBox(value: unknown): boolean {
  return value instanceof MissingBox;
}

show("typeof", () => typeof MissingBox);
show("constructed", () => new MissingBox(1));
show("the argument does not run", () => new MissingBox(noted(1)));
show("the log", () => log.join());
show("a static method", () => MissingBox.make());
show("a static member", () => MissingBox.count);
show("instanceof", () => isBox({}));
show("its prototype", () => MissingBox.prototype);
show("extended", () => {
  class Bigger extends MissingBox {
    extra: number = 1;
  }
  return new Bigger(1).extra;
});
show("extended in a function that is never called", () => {
  function later(): unknown {
    return class extends MissingBox {};
  }
  return typeof later;
});
show("guarded by typeof", () => (typeof MissingBox === "function" ? new MissingBox(1).value : -1));

const standIn: MissingBox = {
  value: 5,
  get(): number {
    return this.value + 1;
  },
};
show("a literal of its type", () => [valueOf(standIn), getOf(standIn), Object.keys(standIn)]);
let sum = 0;
for (let i = 0; i < 2000; i++) sum += valueOf(standIn) + getOf(standIn);
show("2000 uses of the literal", () => sum);
show("is the literal one of them", () => isBox(standIn));

Object.assign(globalThis, {
  MissingBox: class MissingBox {
    held: number;
    constructor(value: number) {
      this.held = value;
    }
    get(): string {
      return "held " + this.held;
    }
  },
});
show("after the global object has another class of that name", () => typeof MissingBox);
const real = new MissingBox(3);
show("its member", () => [real.value, valueOf(real), valueOf(real) + 1]);
show("its method", () => [real.get(), typeof getOf(real), getOf(real) + 1]);
show("its keys", () => Object.keys(real));
show("instanceof", () => [isBox(real), isBox(standIn)]);
show("a static method", () => MissingBox.make());
show("extended", () => {
  class Bigger extends MissingBox {
    extra: number = 1;
  }
  const bigger = new Bigger(4);
  return [Object.keys(bigger), bigger.value, bigger.extra, bigger.get()];
});
show("the literal again", () => [valueOf(standIn), getOf(standIn)]);
