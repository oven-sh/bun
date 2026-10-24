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

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : "another error";
  }
}

function constantMember(): number {
  return Later.Mode.On;
}

function textMember(): string {
  return Later.Word.Yes;
}

function computedMember(): number {
  return Later.Mode.Computed;
}

function byName(name: "Off" | "On"): number {
  return Later.Mode[name];
}

function nameOf(mode: Later.Mode): string {
  return Later.Mode[mode];
}

function deepMember(): number {
  return Later.Inner.Depth.Low;
}

function all(): string[] {
  return [attempt(constantMember), attempt(textMember), attempt(computedMember), attempt(() => byName("On")), attempt(() => nameOf(1)), attempt(deepMember), attempt(() => typeof Later), attempt(() => Object.keys(Later.Mode).length)];
}

show("before", () => all());

namespace Later {
  export const early: string[] = all();
  export enum Mode {
    Off,
    On,
    Computed = "abc".length,
  }
  export const between: string[] = all();
  export enum Word {
    Yes = "yes",
  }
  export namespace Inner {
    export enum Depth {
      Low = 4,
    }
  }
}

show("at the start of the namespace", () => Later.early);
show("after its first enum", () => Later.between);
show("after", () => all());
