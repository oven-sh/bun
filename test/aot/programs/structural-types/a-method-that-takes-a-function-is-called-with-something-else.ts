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

class Plan {
  steps: number = 3;
  run(): number {
    return this.steps;
  }
}

type Wide = (() => number) | number | string | Plan | null | undefined;

interface Runner {
  run(v: Wide): number;
  runTwice(v: Wide): number;
  kind(v: Wide): string;
  arity(v: Wide): number;
  title(v: Wide): string;
  viaCall(v: Wide): number;
  viaApply(v: Wide): number;
  bound(v: Wide): number;
  keep(v: Wide): void;
  each(v: Wide): number[];
}

class FunctionRunner implements Runner {
  kept: () => number = () => -1;
  run(f: () => number): number {
    return f();
  }
  runTwice(f: () => number): number {
    return f() + f();
  }
  kind(f: () => number): string {
    return typeof f;
  }
  arity(f: () => number): number {
    return f.length;
  }
  title(f: () => number): string {
    return f.name;
  }
  viaCall(f: () => number): number {
    return f.call(undefined);
  }
  viaApply(f: () => number): number {
    return f.apply(undefined);
  }
  bound(f: () => number): number {
    return f.bind(undefined)();
  }
  keep(f: () => number): void {
    this.kept = f;
  }
  each(f: () => number): number[] {
    return [1, 2].map(f);
  }
}

const own = new FunctionRunner();
const runner: Runner = own;
function seven(): number {
  return 7;
}
const values: [string, Wide][] = [
  ["function", seven],
  ["arrow", () => 8],
  ["number", 5],
  ["string", "text"],
  ["plan", new Plan()],
  ["null", null],
  ["undefined", undefined],
  ["function again", seven],
];

for (const [label, value] of values) {
  show(label + " run", () => runner.run(value));
  show(label + " runTwice", () => runner.runTwice(value));
  show(label + " kind", () => runner.kind(value));
  show(label + " arity", () => runner.arity(value));
  show(label + " title", () => runner.title(value));
  show(label + " viaCall", () => runner.viaCall(value));
  show(label + " viaApply", () => runner.viaApply(value));
  show(label + " bound", () => runner.bound(value));
  show(label + " each", () => runner.each(value));
  show(label + " keep", () => runner.keep(value));
  show(label + " kept kind", () => typeof own.kept);
  show(label + " kept called", () => own.kept());
}
