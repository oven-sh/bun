function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Step {
  First,
  Second,
  Third,
}

function fail(value: never): string {
  return "reached with " + show(value);
}

function bySwitch(step: Step): string {
  switch (step) {
    case Step.First:
      return "first";
    case Step.Second:
      return "second";
    case Step.Third:
      return "third";
    default:
      return fail(step);
  }
}

function byIf(step: Step): string {
  if (step === Step.First) return "first";
  if (step === Step.Second) return "second";
  if (step === Step.Third) return "third";
  const rest: never = step;
  return "rest " + show(rest);
}

function byConditional(step: Step): string {
  return step === Step.First ? "first" : step === Step.Second ? "second" : step === Step.Third ? "third" : fail(step);
}

function thrown(step: Step): string {
  switch (step) {
    case Step.First:
    case Step.Second:
    case Step.Third:
      return "known";
    default: {
      const rest: never = step;
      throw new RangeError(String(rest));
    }
  }
}

function kindOf(step: Step): string {
  switch (step) {
    case Step.First:
    case Step.Second:
    case Step.Third:
      return "known";
    default:
      return typeof step + " " + `${step}`;
  }
}

const kept: never[] = [];
function keep(step: Step): number {
  if (step === Step.First || step === Step.Second || step === Step.Third) return -1;
  return kept.push(step);
}

function inALoop(steps: Step[]): string {
  let text = "";
  for (const step of steps) {
    switch (step) {
      case Step.First:
        text += "1";
        continue;
      case Step.Second:
        text += "2";
        continue;
      case Step.Third:
        text += "3";
        continue;
    }
    const rest: never = step;
    text += "(" + show(rest) + ")";
  }
  return text;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const step: Step = i % 3;
  warm += bySwitch(step).length + byIf(step).length + byConditional(step).length + thrown(step).length + kindOf(step).length + keep(step);
}
console.log("2000 honest rounds", warm);

const numbers: number[] = [3, -1, 0.5, -0, NaN, Infinity, 2 ** 31, 2 ** 53, -(2 ** 31) - 1];
for (const n of numbers) {
  const step: Step = n;
  const label = show(n);
  attempt(label + " by switch", () => bySwitch(step));
  attempt(label + " by if", () => byIf(step));
  attempt(label + " by conditional", () => byConditional(step));
  attempt(label + " thrown", () => thrown(step));
  attempt(label + " kind", () => kindOf(step));
  attempt(label + " kept", () => keep(step));
}
attempt("what was kept", () => kept);
attempt("in a loop", () => {
  const steps: Step[] = [Step.First, numbers[0], Step.Third, numbers[2], numbers[4], Step.Second];
  return inALoop(steps);
});
attempt("honest again", () => [bySwitch(Step.Third), byIf(Step.Second), byConditional(Step.First), thrown(Step.First), kindOf(Step.Second)]);
