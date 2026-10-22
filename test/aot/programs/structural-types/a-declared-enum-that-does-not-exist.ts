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

declare enum MissingMode {
  Off,
  On,
  Auto = 10,
}

declare enum MissingWord {
  Yes = "yes",
  No = "no",
}

declare const enum FoldedMode {
  Low = 1,
  High = 2,
}

function onValue(): MissingMode {
  return MissingMode.On;
}

function nameOf(mode: MissingMode): string {
  return MissingMode[mode];
}

function isOn(mode: MissingMode): boolean {
  return mode === MissingMode.On;
}

show("typeof", () => [typeof MissingMode, typeof MissingWord]);
show("a member", () => MissingMode.On);
show("a member plus one", () => MissingMode.On + 1);
show("a member with a value", () => MissingMode.Auto);
show("through a function", () => onValue());
show("compared", () => isOn(1));
show("a name by number", () => nameOf(1));
show("a member by a computed name", () => {
  const names: ("Off" | "On")[] = ["Off", "On"];
  return names.map(name => MissingMode[name]);
});
show("a member of the one with strings", () => MissingWord.Yes);
show("its length", () => MissingWord.Yes.length);
show("keys", () => Object.keys(MissingMode));
show("in a switch", () => {
  const mode: MissingMode = 1;
  switch (mode) {
    case MissingMode.Off:
      return "off";
    case MissingMode.On:
      return "on";
    default:
      return "neither";
  }
});
show("a member of the const one", () => [FoldedMode.Low, FoldedMode.High, FoldedMode.Low + FoldedMode.High]);

let failures = 0;
for (let i = 0; i < 2000; i++) {
  try {
    if (isOn(onValue())) failures--;
  } catch (error) {
    if (error instanceof ReferenceError) failures++;
  }
}
show("2000 reads", () => failures);
