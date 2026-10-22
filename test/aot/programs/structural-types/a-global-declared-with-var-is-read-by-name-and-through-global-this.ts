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

declare global {
  var lateCount: number;
  var lateTitle: string;
  var lateStep: (n: number) => number;
  var neverCount: number;
}

function byName(): number {
  return lateCount;
}

function throughObject(): number {
  return globalThis.lateCount;
}

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return error instanceof ReferenceError ? "ReferenceError" : error instanceof TypeError ? "TypeError" : "another error";
  }
}

function state(): string[] {
  return [attempt(byName), attempt(throughObject), attempt(() => byName() + 1), attempt(() => throughObject() + 1), typeof lateCount];
}

show("before", () => state());
show("the one nobody sets", () => [attempt(() => neverCount), attempt(() => globalThis.neverCount), attempt(() => globalThis.neverCount + 1), typeof neverCount]);
show("the text before", () => [attempt(() => lateTitle.length), attempt(() => globalThis.lateTitle.length), attempt(() => globalThis.lateTitle)]);
show("the function before", () => [attempt(() => lateStep(1)), attempt(() => globalThis.lateStep(1))]);

globalThis.lateCount = 5;
show("stored through the object", () => state());
lateCount = 6;
show("stored by name", () => state());
lateCount++;
globalThis.lateCount += 0.5;
show("raised both ways", () => state());

globalThis.lateTitle = "title";
globalThis.lateStep = n => n * 3;
show("the text after", () => [lateTitle.length, globalThis.lateTitle.length]);
show("the function after", () => [lateStep(1), globalThis.lateStep(2)]);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  globalThis.lateCount = i;
  sum += byName() + throughObject();
}
show("2000 stores and reads", () => sum);

const optional: { lateCount?: number } = globalThis;
delete optional.lateCount;
show("deleted", () => state());
show("a store by name after it is deleted", () => attempt(() => (lateCount = 1)));
show("after that", () => state());
globalThis.lateCount = 2;
show("stored through the object again", () => state());

export {};
