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

show("before: the number", () => [counter.start, typeof counter.start]);
show("before: the number plus one", () => counter.start + 1);
show("before: the function runs", () => counter(1));
show("before: the text", () => counter.label);
show("before: the length of the text", () => counter.label.length);
show("before: the helper", () => typeof counter.reset);
show("before: the helper called", () => counter.reset());
show("before: the class", () => typeof counter.Step);
show("before: the class constructed", () => new counter.Step());
show("before: keys", () => Object.keys(counter));
show("before: in", () => "start" in counter);

function counter(n: number): number {
  return n + counter.start;
}

function readStart(): number {
  return counter.start;
}

show("still before: through a function", () => readStart());

namespace counter {
  export const start: number = 10;
  export let label: string = "counter";
  export function reset(): string {
    label = "reset";
    return label;
  }
  export class Step {
    size: number = 1;
  }
  const hidden: number = 5;
  export function hiddenPlus(n: number): number {
    return hidden + n;
  }
}

show("after: the number", () => [counter.start, counter.start + 1, readStart()]);
show("after: the function runs", () => counter(1));
show("after: the text", () => [counter.label, counter.label.length]);
show("after: the helper called", () => [counter.reset(), counter.label]);
show("after: the class constructed", () => new counter.Step().size);
show("after: what is not exported", () => [counter.hiddenPlus(1), "hidden" in counter]);
show("after: keys", () => Object.keys(counter));
show("after: own names", () => Object.getOwnPropertyNames(counter).sort());
show("after: spread", () => Object.keys({ ...counter }));
show("after: JSON", () => JSON.stringify(counter));
show("after: for in", () => {
  const names: string[] = [];
  for (const name in counter) names.push(name);
  return names;
});
show("after: the name and the length of the function", () => [counter.name, counter.length]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += counter(i);
show("2000 calls", () => sum);
