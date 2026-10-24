import * as library from "./library.ts";

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

function plusOne(n: number): number {
  return n + 1;
}

function limitOf(from: { limit: number }): number {
  return from.limit;
}

show("the real ones", () => [library.real, library.realTwice(2)]);
show("the number", () => [library.limit, typeof library.limit]);
show("the number plus one", () => [library.limit + 1, plusOne(library.limit)]);
show("the number through a function", () => [limitOf(library), limitOf({ limit: 3 })]);
show("the text", () => library.title);
show("the length of the text", () => library.title.length);
show("typeof the function", () => typeof library.twice);
show("the function called", () => library.twice(1));
show("the class constructed", () => new library.Box(1));
show("the namespace", () => typeof library.Inner);
show("a member of the namespace", () => library.Inner.depth);
show("the enum", () => typeof library.Mode);
show("a member of the enum", () => library.Mode.On);
show("in", () => ["limit" in library, "real" in library]);
show("keys", () => Object.keys(library));

const loaded = await import("./library.ts");
show("loaded at run time: the number", () => [loaded.limit, loaded.limit + 1]);
show("loaded at run time: the function called", () => loaded.twice(1));
show("loaded at run time: keys", () => Object.keys(loaded));
show("loaded at run time: is it the same object", () => loaded === library);

const { limit, real } = loaded;
show("taken apart", () => [limit, real, plusOne(limit)]);
