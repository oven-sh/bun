function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Leaf {
  weight = 7;
}

const quiet: (() => never)[] = [];
const loose: (() => void)[] = quiet;
loose.push(() => {});

const returns: () => never = quiet[0];
const throws: () => never = () => {
  throw new RangeError("stopped");
};

class Stopper {
  stop(): never {
    throw new RangeError("stopped");
  }
}

function weightOf(l: Leaf | null, stop: () => never): unknown {
  if (l === null) stop();
  return l.weight;
}

function double(v: number | string, stop: () => never): unknown {
  if (typeof v === "string") stop();
  return [v, v * 2, v + 1];
}

function afterTheCall(stop: () => never): unknown {
  const seen: string[] = ["before"];
  try {
    stop();
    seen.push("after");
  } catch {
    seen.push("caught");
  }
  return seen;
}

function resultOfTheCall(stop: () => never): unknown {
  const nothing: never = stop();
  return ["typed never", typeof nothing];
}

function everyPathStops(v: number, stop: () => never): number {
  if (v > 0) return v;
  stop();
}

function inASwitch(mode: "on" | "off", stop: () => never): string {
  switch (mode) {
    case "on":
      return "lit";
    case "off":
      stop();
  }
}

function withTheConstant(l: Leaf | null): unknown {
  if (l === null) returns();
  return l.weight;
}

function round(label: string, stop: () => never): void {
  attempt(label + ": a leaf", () => weightOf(new Leaf(), stop));
  attempt(label + ": null", () => weightOf(null, stop));
  attempt(label + ": a number", () => double(4, stop));
  attempt(label + ": a string", () => double("text", stop));
  attempt(label + ": what follows the call", () => afterTheCall(stop));
  attempt(label + ": the result of the call", () => resultOfTheCall(stop));
  attempt(label + ": a function whose every path stops", () => [everyPathStops(1, stop), everyPathStops(-1, stop)]);
  attempt(label + ": the last case of a switch", () => [inASwitch("on", stop), inASwitch("off", stop)]);
}

round("it throws", throws);
round("a method that throws", () => new Stopper().stop());
for (let i = 0; i < 2000; i++) {
  weightOf(new Leaf(), throws);
  double(i, throws);
  everyPathStops(1, throws);
}
round("it returns", returns);
attempt("called by its own name: a leaf", () => withTheConstant(new Leaf()));
attempt("called by its own name: null", () => withTheConstant(null));
round("it throws again", throws);
