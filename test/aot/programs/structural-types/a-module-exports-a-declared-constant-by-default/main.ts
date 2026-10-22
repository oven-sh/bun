import kind, { read } from "./fine.ts";

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

async function load(label: string): Promise<void> {
  try {
    const loaded = await import("./broken.ts");
    show(label, () => [loaded.default, loaded.before, loaded.after]);
  } catch (error) {
    show(label, () => {
      throw error;
    });
  }
}

show("a module that only asks for its type", () => kind);
show("a function of that module", () => read());
await load("the first load");
await load("the second load");
show("a function of the other module again", () => read());
