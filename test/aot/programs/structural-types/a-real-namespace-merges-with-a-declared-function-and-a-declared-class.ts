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

declare function helper(n: number): number;
namespace helper {
  export const version: number = 1;
  export function describe(): string {
    return "helper " + version;
  }
}

declare class Widget {
  size: number;
  constructor(size: number);
  grow(): number;
}
namespace Widget {
  export const defaultSize: number = 3;
  export function make(): Widget {
    return new Widget(defaultSize);
  }
}

function callHelper(n: number): number {
  return helper(n);
}

show("the function: typeof", () => typeof helper);
show("the function: what the namespace made", () => [helper.version, helper.describe(), Object.keys(helper)]);
show("the function: called", () => helper(1));
show("the function: called through a function", () => callHelper(1));
show("the function: as a callback", () => [1].map(helper));
show("the function: its own name and length", () => [helper.name, helper.length]);
show("the function: call", () => helper.call(undefined, 1));

show("the class: typeof", () => typeof Widget);
show("the class: what the namespace made", () => [Widget.defaultSize, Object.keys(Widget)]);
show("the class: constructed", () => new Widget(1));
show("the class: constructed by the namespace", () => Widget.make());
show("the class: instanceof", () => ({}) instanceof Widget);
show("the class: its prototype", () => Widget.prototype);
show("the class: extended", () => {
  class Bigger extends Widget {}
  return new Bigger(1);
});

let failures = 0;
for (let i = 0; i < 2000; i++) {
  try {
    callHelper(i);
  } catch (error) {
    if (error instanceof TypeError) failures++;
  }
}
show("2000 calls", () => failures);
