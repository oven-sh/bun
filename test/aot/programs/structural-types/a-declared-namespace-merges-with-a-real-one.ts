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

declare namespace First {
  const promised: number;
  let promisedTitle: string;
  function promisedTwice(n: number): number;
}
namespace First {
  export const made: number = 1;
  export function both(): number {
    return made + promised;
  }
  export function heading(): string {
    return promisedTitle + "!";
  }
  export function viaPromised(n: number): number {
    return promisedTwice(n);
  }
}

namespace Second {
  export const made: number = 2;
  export function both(): number {
    return made + promised;
  }
}
declare namespace Second {
  const promised: number;
}

function promisedOf(): number {
  return First.promised;
}

show("the declared part comes first: typeof", () => typeof First);
show("what is made", () => [First.made, Object.keys(First)]);
show("what is promised, from outside", () => [First.promised, typeof First.promised, promisedOf(), promisedOf() + 1]);
show("what is promised, from inside", () => First.both());
show("the promised text, from outside", () => First.promisedTitle);
show("the promised text, from inside", () => First.heading());
show("the promised function, from outside", () => First.promisedTwice(1));
show("the promised function, from inside", () => First.viaPromised(1));
show("in", () => ["promised" in First, "made" in First]);

show("the declared part comes second: typeof", () => typeof Second);
show("what is made", () => [Second.made, Object.keys(Second)]);
show("what is promised, from outside", () => [Second.promised, Second.promised + 1]);
show("what is promised, from inside", () => Second.both());

First.promisedTitle = "stored";
show("after a store: from outside", () => [First.promisedTitle, Object.keys(First)]);
show("after a store: from inside", () => First.heading());

const writable: { promised: number } = First;
writable.promised = 10;
show("after the constant is stored to through a view", () => [First.promised, promisedOf(), Object.keys(First)]);
show("after that, from inside", () => First.both());
