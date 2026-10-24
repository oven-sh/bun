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

class Person {
  first: string = "ann";
}

const registry: Widget[] = [];
const byName = new Map<string, Widget>();
let latest: Widget | undefined;
const seen: string[] = [];

function look(label: string, w: Widget): void {
  const parts: string[] = [];
  const uses: [string, () => unknown][] = [
    ["size", () => w.size],
    ["size + 1", () => w.size + 1],
    ["title", () => w.title],
    ["title.length", () => w.title.length],
    ["owner", () => w.owner],
    ["owner.first", () => w.owner.first],
    ["parts.length", () => w.parts.length],
    ["area()", () => w.area()],
    ["keys", () => Object.keys(w).join("+")],
  ];
  for (const [name, use] of uses) {
    try {
      parts.push(name + "=" + text(use()));
    } catch (error) {
      parts.push(name + "=threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
  }
  seen.push(label + ": " + parts.join(", "));
}

class Widget {
  size: number;
  title: string;
  owner: Person;
  parts: number[];
  constructor(name: string, visit: (w: Widget) => void) {
    latest = this;
    registry.push(this);
    byName.set(name, this);
    look("at the start", this);
    visit(this);
    this.size = 2;
    look("after size", this);
    this.title = name;
    this.owner = new Person();
    look("after owner", this);
    [1].forEach(() => look("in a built-in's callback", this));
    this.parts = [1, 2];
    look("at the end", this);
  }
  area(): number {
    return this.size * this.size;
  }
}

const first = new Widget("first", w => look("in the caller's callback", w));
for (const entry of seen) console.log(entry);
seen.length = 0;

show("the global is the widget", () => latest === first);
show("the collection holds it", () => registry[0] === first);
show("the map holds it", () => byName.get("first") === first);

new Widget("second", w => {
  w.size = 100;
  w.title = "set by the callback";
});
for (const entry of seen) console.log(entry);
seen.length = 0;

function sizeOf(w: Widget): number {
  return w.size;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += sizeOf(first);
show("2000 finished widgets", () => sum);
let earlySize: unknown = "not run";
new Widget("third", w => {
  earlySize = sizeOf(w);
});
show("an unfinished one at the same function", () => earlySize);
