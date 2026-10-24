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

Object.assign(globalThis, { MissingMode: { Off: "off", On: 7, 7: "On" }, MissingWord: { Yes: 1 } });
show("after the global object has them: typeof", () => [typeof MissingMode, typeof MissingWord]);
show("a member", () => [MissingMode.On, MissingMode.On + 1, onValue()]);
show("a member that is text", () => [MissingMode.Off, typeof MissingMode.Off]);
show("a member that is not there", () => [MissingMode.Auto, MissingMode.Auto + 1]);
show("compared", () => [isOn(1), isOn(7)]);
show("a name by number", () => [nameOf(1), nameOf(7)]);
show("a member of the one with strings", () => [MissingWord.Yes, typeof MissingWord.Yes]);
show("keys", () => Object.keys(MissingMode));
