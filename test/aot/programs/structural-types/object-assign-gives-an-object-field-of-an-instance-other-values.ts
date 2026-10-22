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

function depthOf(p: Part): number {
  return p.inner.depth;
}

function useInner(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.inner);
  attempt(label + ", is undefined", () => p.inner === undefined);
  attempt(label + ", is null", () => p.inner === null);
  attempt(label + ", is truthy", () => !!p.inner);
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.inner === "object" && q.inner !== null).length);
  attempt(label + ", its member", () => p.inner.depth);
  attempt(label + ", its member plus one", () => p.inner.depth + 1);
  attempt(label + ", its keys", () => Object.keys(p.inner).join());
  attempt(label + ", a copy of it", () => JSON.stringify({ ...p.inner }));
  attempt(label + ", in", () => "depth" in p.inner);
  attempt(label + ", a pattern", () => (({ depth }: Inner) => depth)(p.inner));
  attempt(label + ", a typed function", () => depthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", its member stored", () => (p.inner.depth = 9));
  attempt(label + ", its member after the store", () => p.inner.depth);
  attempt(label + ", replaced", () => (p.inner = { depth: 8 }).depth);
  attempt(label + ", its member after that", () => p.inner.depth);
}

function briefInner(label: string, p: Part): void {
  attempt(label + ", used", () => p.inner.depth);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function innerInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.inner.depth);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].inner.depth);
  attempt(label + ", a result", () => make().inner.depth);
}

function innerInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.inner.depth;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const innerWrites: [string, (p: Part) => void][] = [
  ["inner becomes a number", p => { Object.assign(p, { inner: 5 }); }],
  ["inner becomes a string", p => { Object.assign(p, { inner: "text" }); }],
  ["inner becomes null", p => { Object.assign(p, { inner: null }); }],
  ["inner becomes undefined", p => { Object.assign(p, { inner: undefined }); }],
  ["inner becomes another shape", p => { Object.assign(p, { inner: { deep: 1 } }); }],
  ["inner becomes the member and more", p => { Object.assign(p, { inner: { extra: 0, depth: 6 } }); }],
  ["inner becomes an array", p => { Object.assign(p, { inner: [1, 2] }); }],
  ["inner becomes a function", p => { Object.assign(p, { inner: () => 1 }); }],
  ["inner becomes a string under the member", p => { Object.assign(p, { inner: { depth: "deep" } }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useInner("", fresh());
  briefInner("", other());
}
innerInPlaces("", fresh);
innerInALoop("", () => {});
quiet = false;

useInner("untouched", fresh());

for (const [label, write] of innerWrites) {
  const first = fresh();
  write(first);
  useInner(label + ", an instance", first);
  const second = other();
  write(second);
  briefInner(label + ", a subclass instance", second);
  innerInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  innerInALoop(label, write);
}

useInner("untouched afterwards", fresh());

export {};
