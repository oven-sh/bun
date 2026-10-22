import { Meter } from "./meter.ts";
import { extraOf, extraPlusOwn } from "./more.ts";

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

const meter = new Meter();
show("read here", () => meter.extra);
show("typeof", () => typeof meter.extra);
show("plus one", () => meter.extra + 1);
show("read by the file that promised it", () => extraOf(meter));
show("added by that file", () => extraPlusOwn(meter));
show("the member that is made", () => [meter.own, meter.twiceOwn()]);
show("in", () => "extra" in meter);
show("keys", () => Object.keys(meter));
show("JSON", () => JSON.stringify(meter));
show("spread", () => ({ ...meter }));
show("2000 reads", () => {
  let missing = 0;
  for (let i = 0; i < 2000; i++) if (extraOf(new Meter()) === undefined) missing++;
  return missing;
});
