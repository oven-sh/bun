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

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
  twice(): number {
    return this.x * 2;
  }
}

const points: Record<string, Point> = { origin: new Point(0), one: new Point(1) };
const handlers: { [event: string]: (n: number) => number } = { double: n => n * 2 };
const lists: Record<string, number[]> = { odd: [1, 3] };
const texts: { [key: string]: string } = { greeting: "hello" };
const nested: Record<string, Record<string, number>> = { outer: { inner: 1 } };

function xOf(name: string): number {
  return points[name].x;
}

function twiceOf(name: string): number {
  return points[name].twice();
}

function fire(event: string, n: number): number {
  return handlers[event](n);
}

function lengthOfList(name: string): number {
  return lists[name].length;
}

function lengthOfText(key: string): number {
  return texts[key].length;
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += xOf("one") + twiceOf("one") + fire("double", i) + lengthOfList("odd") + lengthOfText("greeting");
show("2000 honest rounds", () => sum);

show("an object: read", () => [points.missing, typeof points.missing]);
show("an object: a member", () => xOf("missing"));
show("an object: a method", () => twiceOf("missing"));
show("an object: a member if there", () => points.missing?.x);
show("an object: under an inherited name", () => [typeof points["toString"], xOf("toString")]);
show("an object: a method under an inherited name", () => twiceOf("toString"));
show("a function: read", () => typeof handlers.missing);
show("a function: called", () => fire("missing", 1));
show("a function: under an inherited name", () => Object.is(fire("valueOf", 1), handlers));
show("a function: under another inherited name", () => fire("hasOwnProperty", 1));
show("a list: length", () => lengthOfList("missing"));
show("a list: iterated", () => [...lists.missing]);
show("a list: pushed to", () => lists.missing.push(1));
show("a list: under an inherited name", () => lengthOfList("toString"));
show("a text: read", () => texts.missing);
show("a text: length", () => lengthOfText("missing"));
show("a text: followed by a string", () => texts.missing + "!");
show("a text: under an inherited name", () => [typeof texts["constructor"], lengthOfText("constructor")]);
show("two levels: the inner one is missing", () => [nested.outer.missing, nested.outer.missing + 1]);
show("two levels: the outer one is missing", () => nested.missing.inner);
show("honest again", () => [xOf("one"), twiceOf("one"), fire("double", 2), lengthOfList("odd"), lengthOfText("greeting")]);
