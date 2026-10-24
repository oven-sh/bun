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

namespace Steps {
  export let count: number = 0;
  export function viaLater(): number {
    return later() + 1;
  }
  export function readValue(): number {
    return value;
  }
  export function readValuePlusOne(): number {
    return value + 1;
  }
  export function makeLate(): number {
    return new Late().size;
  }
  export function lateMode(): number {
    return Mode.Second;
  }
  export enum Mode {
    First,
  }
  export const atStart: string[] = [attempt(viaLater), attempt(readValue), attempt(readValuePlusOne), attempt(makeLate), attempt(lateMode)];
}

show("what the first block saw", () => Steps.atStart);
show("between the blocks", () => [attempt(Steps.viaLater), attempt(Steps.readValue), attempt(Steps.readValuePlusOne), attempt(Steps.makeLate), attempt(Steps.lateMode)]);
show("between the blocks: from outside", () => [attempt(() => Steps.value), attempt(() => Steps.later()), attempt(() => Steps.Mode.Second), typeof Steps.Late]);
show("between the blocks: keys", () => [Object.keys(Steps), Object.keys(Steps.Mode)]);

namespace Steps {
  export function later(): number {
    return count * 10;
  }
  export const value: number = 7;
  export class Late {
    size: number = 3;
  }
  export enum Mode {
    Second = 5,
  }
}

show("after both", () => [attempt(Steps.viaLater), attempt(Steps.readValue), attempt(Steps.readValuePlusOne), attempt(Steps.makeLate), attempt(Steps.lateMode)]);
show("after both: keys", () => [Object.keys(Steps), Object.keys(Steps.Mode)]);

Steps.count = 5;
show("a variable of the first block, stored from outside and read by the second", () => [Steps.count, Steps.later(), Steps.viaLater()]);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  Steps.count++;
  sum += Steps.viaLater() + Steps.readValue();
}
show("2000 rounds", () => [sum, Steps.count]);
