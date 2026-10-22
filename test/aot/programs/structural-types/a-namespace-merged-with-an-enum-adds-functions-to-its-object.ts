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

function early(): unknown[] {
  return [typeof Color.parse, typeof Color.fallback, Color.Red, Color.Green];
}

enum Color {
  Red,
  Green = 5,
  Blue,
}

show("between the two: what is there", () => early());
show("between the two: the helper called", () => Color.parse("Red"));
show("between the two: the member plus one", () => Color.fallback + 1);
show("between the two: keys", () => Object.keys(Color));

namespace Color {
  export function parse(name: string): Color {
    return name === "Red" ? Color.Red : name === "Green" ? Color.Green : Color.Blue;
  }
  export const fallback: Color = Color.Blue;
  export let picked: Color;
}

function nameOf(color: Color): string {
  return Color[color];
}

show("after: what is there", () => early());
show("after: the helper called", () => [Color.parse("Red"), Color.parse("Green"), Color.parse("x")]);
show("after: the member", () => [Color.fallback, Color.fallback + 1, nameOf(Color.fallback)]);
show("after: the variable without a value", () => [Color.picked, typeof Color.picked, "picked" in Color]);
show("after: its name", () => nameOf(Color.picked));
show("after: is it the first member", () => Color.picked === Color.Red);
show("after: keys", () => Object.keys(Color));
show("after: values", () => Object.values(Color).map(value => typeof value));
show("after: the numbers among the values", () => Object.values(Color).filter(value => typeof value === "number"));
show("after: names by number", () => [Color[0], Color[5], Color[6], Color[1]]);
show("after: the name of a helper is no color", () => {
  const names = Object.keys(Color).filter(key => Number.isNaN(Number(key)));
  return names;
});
Color.picked = Color.Green;
show("after a store", () => [Color.picked, nameOf(Color.picked), Object.keys(Color).length]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += Color.parse(i % 2 === 0 ? "Red" : "Green") + nameOf(Color.Blue).length;
show("2000 calls", () => sum);
