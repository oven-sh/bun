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

declare namespace MissingTools {
  const scale: number;
  let title: string;
  function grow(n: number): number;
  class Gear {
    teeth: number;
  }
  namespace Inner {
    const depth: number;
  }
  enum Mode {
    On,
    Off,
  }
}

function scaleOf(): number {
  return MissingTools.scale;
}

function scaleOr(fallback: number): number {
  return typeof MissingTools === "object" ? MissingTools.scale : fallback;
}

show("typeof", () => typeof MissingTools);
show("a constant", () => MissingTools.scale);
show("a constant plus one", () => MissingTools.scale + 1);
show("through a function", () => scaleOf());
show("guarded by typeof", () => scaleOr(3));
show("typeof a member", () => typeof MissingTools.scale);
show("a variable", () => MissingTools.title);
show("a store to the variable", () => (MissingTools.title = "stored"));
show("a function", () => MissingTools.grow(1));
show("a class", () => new MissingTools.Gear());
show("an inner namespace", () => MissingTools.Inner.depth);
show("an enum inside", () => MissingTools.Mode.On);
show("if there", () => MissingTools?.scale);
show("keys", () => Object.keys(MissingTools));

let failures = 0;
let guarded = 0;
for (let i = 0; i < 2000; i++) {
  guarded += scaleOr(1);
  try {
    scaleOf();
  } catch (error) {
    if (error instanceof ReferenceError) failures++;
  }
}
show("2000 reads", () => [failures, guarded]);
