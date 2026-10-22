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

declare var early: number;
declare var label: string;

function readEarly(): number {
  return early;
}

function readLate(): number {
  return late;
}

show("before: the one declared first", () => [early, typeof early, readEarly()]);
show("before: plus one", () => early + 1);
show("before: the one declared afterwards", () => [late, typeof late, readLate()]);
show("before: the text", () => label);
show("before: the length of the text", () => label.length);
show("before: on the global object", () => ["early" in globalThis, "late" in globalThis]);

var early = 5;
var late = 6;
var label = "made";

declare var late: number;

show("after: the one declared first", () => [early, typeof early, readEarly(), early + 1]);
show("after: the one declared afterwards", () => [late, typeof late, readLate(), late + 1]);
show("after: the text", () => [label, label.length]);
show("after: on the global object", () => ["early" in globalThis, "late" in globalThis]);

early = 7;
late++;
show("after stores", () => [early, readEarly(), late, readLate()]);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  early = i;
  sum += readEarly() + readLate();
}
show("2000 stores and reads", () => sum);

export {};
