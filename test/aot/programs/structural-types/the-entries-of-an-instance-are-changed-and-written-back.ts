interface Inner {
  depth: number;
}

class Part {
  count = 1;
  label = "part";
  inner: Inner = { depth: 2 };
  action: () => number = () => 3;
  note?: string = "note";
  readonly id: number = 4;
  total(): number {
    return this.count + this.inner.depth + this.action() + this.id;
  }
  title(): string {
    return this.label + ":" + (this.note ?? "none");
  }
}

class SubPart extends Part {
  extra = 5;
  total(): number {
    return super.total() + this.extra;
  }
}

function fresh(): Part {
  return new Part();
}

function other(): Part {
  return new SubPart();
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + " [" + log.join() + "]");
  log.length = 0;
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function totalOf(p: Part): number {
  return p.total();
}

function use(label: string, p: Part): void {
  attempt(label + ", total", () => p.total());
  attempt(label + ", title", () => p.title());
  attempt(label + ", typeof total", () => typeof p.total);
  attempt(label + ", a typed function calls total", () => totalOf(p));
  attempt(label + ", count", () => p.count + 1);
  attempt(label + ", typeof count", () => typeof p.count);
  attempt(label + ", label", () => p.label.length);
  attempt(label + ", inner", () => p.inner.depth);
  attempt(label + ", action", () => p.action());
  attempt(label + ", note", () => p.note ?? "none");
  attempt(label + ", id", () => p.id + 1);
  attempt(label + ", instanceof its class", () => p instanceof Part);
  attempt(label + ", instanceof the subclass", () => p instanceof SubPart);
  attempt(label + ", its prototype is that of its class", () => Object.getPrototypeOf(p) === Part.prototype);
  attempt(label + ", the name of its constructor", () => p.constructor.name);
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", for-in", () => (() => {
    let walked = "";
    for (const key in p) walked += key + ",";
    return walked;
  })());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", as text", () => String(p));
  attempt(label + ", has toString", () => "toString" in p);
  attempt(label + ", hasOwnProperty", () => p.hasOwnProperty("count"));
  attempt(label + ", count stored", () => (p.count = 10));
  attempt(label + ", total after the store", () => p.total());
}

function inPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.total() + holder.part.count);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].total() + list[1].count);
  attempt(label + ", a result", () => make().total());
}

function inALoop(label: string, change: (p: Part) => Part): void {
  let p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", changed in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) p = change(p);
      const value = p.total() + p.count;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

const changes: [string, (p: Part) => Part][] = [
  ["its entries are written back", p => Object.assign(p, Object.fromEntries(Object.entries(p)))],
  ["every value is written back as text", p => Object.assign(p, Object.fromEntries(Object.entries(p).map(([key, value]) => [key, String(value)])))],
  ["every number is written back doubled", p => Object.assign(p, Object.fromEntries(Object.entries(p).map(([key, value]) => [key, typeof value === "number" ? value * 2 : value])))],
  ["every value is written back as undefined", p => Object.assign(p, Object.fromEntries(Object.keys(p).map(key => [key, undefined])))],
  ["each name gets the value of the next", p => Object.assign(p, Object.fromEntries(Object.keys(p).map((key, index, keys) => [key, Reflect.get(p, keys[(index + 1) % keys.length])])))],
  ["entries out of a map", p => Object.assign(p, Object.fromEntries(new Map<string, unknown>([["count", "text"], ["added", 1]])))],
  ["the names in capitals are added", p => Object.assign(p, Object.fromEntries(Object.entries(p).map(([key, value]) => [key.toUpperCase(), value])))],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  use("", fresh());
  use("", other());
}
inPlaces("", fresh);
inALoop("", p => p);
quiet = false;

use("untouched", fresh());

for (const [label, change] of changes) {
  use(label + ", an instance", change(fresh()));
  use(label + ", a subclass instance", change(other()));
  inPlaces(label, () => change(fresh()));
  inALoop(label, change);
}

use("untouched afterwards", fresh());

export {};
