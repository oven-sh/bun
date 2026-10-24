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
  interface Array<T> {
    penultimate(): T;
    spare: T;
  }

  interface String {
    reversed(): string;
  }

  interface Number {
    squared: number;
  }
}

function spareOf(list: number[]): number {
  return list.spare;
}

show("the method", () => [typeof [1, 2].penultimate, typeof "ab".reversed]);
show("called on a list", () => [1, 2, 3].penultimate());
show("called on a string", () => "abc".reversed());
show("the member of a list", () => [[1, 2].spare, spareOf([1, 2]), spareOf([1, 2]) + 1]);
show("the member of a list of strings", () => ["a"].spare);
show("its length", () => ["a"].spare.length);
show("the member of a number", () => [(3).squared, (3).squared + 1, typeof (3).squared]);
show("the real ones still work", () => [[1, 2, 3].at(-2), "abc".length, (3).toFixed(1)]);

let missing = 0;
for (let i = 0; i < 2000; i++) if (spareOf([i]) === undefined && i.squared === undefined) missing++;
show("2000 rounds", () => missing);

export {};
