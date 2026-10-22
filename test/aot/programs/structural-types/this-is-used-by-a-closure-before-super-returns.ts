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

function attempt(label: string, run: () => unknown): void {
  try {
    log.push(label + ": " + text(run()));
  } catch (error) {
    log.push(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Base {
  low: number = 1;
  constructor(peek: () => unknown) {
    attempt("in the base constructor", peek);
  }
}

class Derived extends Base {
  high: number = 2;
  constructor() {
    const peek = (): unknown => this.high;
    const whole = (): unknown => typeof this;
    attempt("before super", peek);
    attempt("before super, typeof", whole);
    super(peek);
    attempt("after super", peek);
    attempt("after super, typeof", whole);
  }
}

new Derived();
for (const entry of log) console.log(entry);
