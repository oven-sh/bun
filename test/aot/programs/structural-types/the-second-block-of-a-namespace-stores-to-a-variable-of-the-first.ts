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

namespace Tally {
  export let count: number = 0;
  export let label: string = "start";
  export function bumpHere(): void {
    count++;
  }
}

namespace Tally {
  export function read(): number {
    return count;
  }
  export function bump(): number {
    return count++;
  }
  export function set(n: number): void {
    count = n;
  }
  export function add(n: number): number {
    return (count += n);
  }
  export function rename(text: string): void {
    label = text;
  }
  export function takeApart(pair: [number, string]): void {
    [count, label] = pair;
  }
}

show("read", () => Tally.read());
show("raised by the first block", () => {
  Tally.bumpHere();
  return [Tally.count, Tally.read()];
});
show("++ in the second block", () => Tally.bump());
show("after it", () => [Tally.count, Tally.read()]);
show("a store in the second block", () => Tally.set(10));
show("after it", () => [Tally.count, Tally.read()]);
show("+= in the second block", () => Tally.add(5));
show("after it", () => [Tally.count, Tally.read()]);
show("a store to the text", () => Tally.rename("renamed"));
show("after it", () => Tally.label);
show("taken apart into both", () => Tally.takeApart([20, "apart"]));
show("after it", () => [Tally.count, Tally.label]);
show("did a global appear", () => ["count" in globalThis, "label" in globalThis]);
