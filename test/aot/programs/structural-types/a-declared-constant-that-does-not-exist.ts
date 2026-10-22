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

declare const missingCount: number;
declare const missingText: string;
declare const missingPoint: { x: number; y: number };
declare const missingList: number[];

const log: string[] = [];
function noted(n: number): number {
  log.push("ran " + n);
  return n;
}

function plusOne(n: number): number {
  return n + 1;
}

function readCount(): number {
  return missingCount;
}

function countOr(fallback: number): number {
  return typeof missingCount === "number" ? missingCount : fallback;
}

class Holder {
  count: number = missingCount;
}

show("typeof", () => [typeof missingCount, typeof missingText, typeof missingPoint, typeof missingList]);
show("read", () => missingCount);
show("plus one", () => missingCount + 1);
show("what stands on the left runs first", () => noted(1) + missingCount);
show("what stands on the right does not run", () => missingCount + noted(2));
show("the log", () => log.join());
show("through a function", () => readCount());
show("given to a typed function", () => plusOne(missingCount));
show("guarded by typeof", () => countOr(7));
show("behind a false condition", () => (log.length > 100 ? missingCount : -1));
show("behind &&", () => log.length > 100 && missingCount);
show("in a template", () => `${missingCount}`);
show("as the value of a field", () => new Holder().count);
show("as the default of a parameter", () => ((n: number = missingCount) => n)());
show("as the default of a parameter that is given", () => ((n: number = missingCount) => n)(3));
show("in a list", () => [1, missingCount]);
show("in an object", () => ({ count: missingCount }));
show("in a closure that is never called", () => typeof (() => missingCount));
show("the text: length", () => missingText.length);
show("the text: followed by a string", () => missingText + "!");
show("the point: a member", () => missingPoint.x);
show("the point: a member if there", () => missingPoint?.x);
show("the list: length", () => missingList.length);
show("the list: iterated", () => [...missingList]);
show("on the global object", () => "missingCount" in globalThis);

let failures = 0;
for (let i = 0; i < 2000; i++) {
  try {
    readCount();
  } catch (error) {
    if (error instanceof ReferenceError) failures++;
  }
}
show("2000 reads", () => failures);
show("2000 guarded reads", () => {
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += countOr(1);
  return sum;
});
