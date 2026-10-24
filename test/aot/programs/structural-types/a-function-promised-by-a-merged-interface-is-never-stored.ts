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

interface Button {
  step: (n: number) => number;
  compare: (a: number, b: number) => number;
  swap: (found: string) => string;
}
class Button {
  id: number = 1;
  press(): number {
    return this.step(1);
  }
}

function apply(f: (n: number) => number, n: number): number {
  return f(n);
}

function stepOf(button: Button): (n: number) => number {
  return button.step;
}

const log: string[] = [];
function noted(n: number): number {
  log.push("argument " + n);
  return n;
}

show("an honest caller", () => apply(n => n + 1, 1));

const button = new Button();
show("read", () => button.step);
show("typeof", () => typeof button.step);
show("not", () => !button.step);
show("called", () => button.step(1));
show("called, and the argument ran first", () => button.step(noted(5)));
show("the log", () => log.join());
show("called if there", () => button.step?.(1));
show("called if there, and the argument did not run", () => button.step?.(noted(6)));
show("the log", () => log.join());
show("call", () => button.step.call(undefined, 1));
show("apply", () => button.step.apply(undefined, [1]));
show("bind", () => button.step.bind(undefined));
show("its name", () => button.step.name);
show("its length", () => button.step.length);
show("taken off and called", () => {
  const step = button.step;
  return step(1);
});
show("in a method", () => button.press());
show("through a function", () => stepOf(button));
show("through a function and called", () => stepOf(button)(1));
show("given to a typed function", () => apply(button.step, 1));
show("map", () => [1, 2].map(button.step));
show("map of an empty list", () => {
  const none: number[] = [];
  return none.map(button.step);
});
show("Array.from", () => Array.from([1, 2], button.step));
show("sort", () => [10, 9, 1].sort(button.compare));
show("toSorted", () => [10, 9, 1].toSorted(button.compare));
show("replace", () => "abc".replace("b", button.swap));
show("a typed element", () => {
  const steps: ((n: number) => number)[] = [button.step, n => n];
  return steps;
});
show("or another", () => (button.step ?? ((n: number) => n * 10))(2));
show("in", () => "step" in button);
show("keys", () => Object.keys(button));
show("JSON", () => JSON.stringify(button));
show("an honest caller again", () => apply(n => n + 1, 1));

const settled = await Promise.resolve(4).then(button.step);
show("a promise passes its value by a reaction that is not there", () => settled);

export {};
