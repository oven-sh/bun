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

class Settings {
  depth?: number;
  title?: string;
  id: number = 1;
}

class Filled extends Settings {
  depth: number = 2;
  title: string = "filled";
}

function depthOf(settings: Required<Settings>): number {
  return settings.depth;
}

function titleLength(settings: Required<Settings>): number {
  return settings.title.length;
}

function strip(settings: Settings): void {
  delete settings.depth;
  delete settings.title;
}

function blank(settings: Settings): void {
  settings.depth = undefined;
  settings.title = undefined;
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += depthOf(new Filled()) + titleLength(new Filled());
show("2000 honest rounds", () => sum);

const filled = new Filled();
show("filled", () => [depthOf(filled), depthOf(filled) + 1, titleLength(filled), Object.keys(filled)]);
strip(filled);
show("stripped: the number", () => [depthOf(filled), depthOf(filled) + 1, filled.depth]);
show("stripped: the length of the text", () => titleLength(filled));
show("stripped: keys", () => Object.keys(filled));
show("stripped: in", () => ["depth" in filled, "title" in filled]);

const blanked = new Filled();
blank(blanked);
show("blanked: the number", () => [depthOf(blanked), depthOf(blanked) + 1]);
show("blanked: the length of the text", () => titleLength(blanked));
show("blanked: keys", () => Object.keys(blanked));
show("blanked: JSON", () => JSON.stringify(blanked));

show("a bare instance of the base class", () => [Object.keys(new Settings()), "depth" in new Settings(), new Settings().depth]);
show("three in a row", () => [new Filled(), filled, blanked].map(depthOf));
show("a fresh one again", () => [depthOf(new Filled()), titleLength(new Filled())]);
