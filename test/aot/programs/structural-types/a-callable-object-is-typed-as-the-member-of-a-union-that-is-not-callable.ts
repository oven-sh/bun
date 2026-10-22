function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Config {
  size: number;
  label: string;
}
type Source = Config | (() => Config);

function resolve(source: Source): Config {
  return typeof source === "function" ? source() : source;
}
function sizeOf(source: Source): number {
  if (typeof source === "function") return source().size;
  return source.size;
}
function labelOf(source: Source): string {
  if (typeof source !== "function") return source.label;
  return source().label;
}

const plain: Config = { size: 1, label: "plain" };
const maker = (): Config => ({ size: 2, label: "made" });
const both = Object.assign((): string => "not a config", { size: 3, label: "both" });
const asConfig: Config = both;
const numberMaker = Object.assign((): number => 5, { size: 4, label: "number maker" });
const alsoConfig: Config = numberMaker;
class Static {
  static size: number = 6;
  static label: string = "class";
}
const classAsConfig: Config = Static;

const sources: [string, Source][] = [
  ["plain", plain],
  ["maker", maker],
  ["a function typed as the object", asConfig],
  ["another", alsoConfig],
  ["a class typed as the object", classAsConfig],
  ["plain again", plain],
];

for (const [label, source] of sources) {
  show(label + " resolve", () => resolve(source));
  show(label + " typeof resolve", () => typeof resolve(source));
  show(label + " size", () => sizeOf(source));
  show(label + " size + 1", () => sizeOf(source) + 1);
  show(label + " label", () => labelOf(source));
  show(label + " label length", () => labelOf(source).length);
}

function direct(c: Config): string {
  return c.size + " " + c.label;
}
show("direct: plain", () => direct(plain));
show("direct: a function", () => direct(asConfig));
show("direct: a class", () => direct(classAsConfig));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += sizeOf(i % 2 === 0 ? plain : maker);
show("2000 honest sources", () => sum);
show("then the function typed as the object", () => sizeOf(asConfig));
