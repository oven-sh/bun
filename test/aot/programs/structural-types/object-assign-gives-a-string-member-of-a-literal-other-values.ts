interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
  };
}

function other(): Part {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1,
  };
}

let quiet = false;

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
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function lengthOf(p: Part): number {
  return p.label.length;
}

function useLabel(label: string, p: Part): void {
  attempt(label + ", read", () => p.label);
  attempt(label + ", typeof", () => typeof p.label);
  attempt(label + ", its length", () => p.label.length);
  attempt(label + ", glued", () => p.label + "!");
  attempt(label + ", a method of the string", () => p.label.toUpperCase());
  attempt(label + ", compared", () => p.label === "part");
  attempt(label + ", is undefined", () => p.label === undefined);
  attempt(label + ", is a string", () => typeof p.label === "string");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.label === "string").length);
  attempt(label + ", a typed function", () => lengthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", appended to", () => (p.label += "?"));
  attempt(label + ", stored", () => (p.label = "stored"));
  attempt(label + ", read after the store", () => p.label);
}

function briefLabel(label: string, p: Part): void {
  attempt(label + ", used", () => p.label.length);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function labelInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.label.length);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].label.length);
  attempt(label + ", a result", () => make().label.length);
}

function labelInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.label.length;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const labelWrites: [string, (p: Part) => void][] = [
  ["label becomes a number", p => { Object.assign(p, { label: 7 }); }],
  ["label becomes undefined", p => { Object.assign(p, { label: undefined }); }],
  ["label becomes null", p => { Object.assign(p, { label: null }); }],
  ["label becomes an array", p => { Object.assign(p, { label: ["a", "b"] }); }],
  ["label becomes an object with a length", p => { Object.assign(p, { label: { length: 3 } }); }],
  ["label becomes a symbol", p => { Object.assign(p, { label: Symbol("s") }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useLabel("", fresh());
  briefLabel("", other());
}
labelInPlaces("", fresh);
labelInALoop("", () => {});
quiet = false;

useLabel("untouched", fresh());

for (const [label, write] of labelWrites) {
  const first = fresh();
  write(first);
  useLabel(label + ", a literal", first);
  const second = other();
  write(second);
  briefLabel(label + ", a literal written backwards", second);
  labelInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  labelInALoop(label, write);
}

useLabel("untouched afterwards", fresh());

export {};
