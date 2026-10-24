function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

type HasLength = { length: number };

class Shelf {
  item: HasLength;
  reads = 0;
  constructor(item: HasLength) {
    this.item = item;
  }
  size(): number {
    this.reads++;
    return this.item.length;
  }
  kind(): string {
    return typeof this.item;
  }
  swap(next: HasLength): HasLength {
    const old = this.item;
    this.item = next;
    return old;
  }
}

class StartsAsAString {
  before = 1.5;
  item: HasLength = "initial";
  after = 2.5;
}

class Hidden {
  #item: HasLength;
  constructor(item: HasLength) {
    this.#item = item;
  }
  size(): number {
    return this.#item.length;
  }
  kind(): string {
    return typeof this.#item;
  }
}

class ByParameter {
  constructor(public readonly item: HasLength, public weight: number) {}
}

class Registry {
  static latest: HasLength = { length: -1 };
  static size(): number {
    return Registry.latest.length;
  }
}

function sizeOfShelf(shelf: Shelf): number {
  return shelf.item.length;
}

const values: [string, HasLength][] = [
  ["literal", { length: 3 }],
  ["string", "hello"],
  ["empty string", ""],
  ["array", [1, 2]],
  ["function", sizeOfShelf],
  ["class", Shelf],
  ["typed array", new Int16Array(9)],
];

let warm = 0;
const reused = new Shelf({ length: 0 });
for (let i = 0; i < 2000; i++) {
  const shelf = new Shelf({ length: i });
  warm += shelf.size() + sizeOfShelf(shelf);
  reused.swap({ length: i });
  warm += reused.size() + new Hidden({ length: i }).size() + new ByParameter({ length: i }, i).item.length;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": a new shelf", () => {
    const shelf = new Shelf(value);
    return [shelf.kind(), shelf.size(), sizeOfShelf(shelf), shelf.reads, shelf.item === value];
  });
  attempt(name + ": swapped into an old shelf", () => {
    const old = reused.swap(value);
    return [typeof old, old.length, reused.kind(), reused.size(), sizeOfShelf(reused)];
  });
  attempt(name + ": a private field", () => {
    const hidden = new Hidden(value);
    return [hidden.kind(), hidden.size()];
  });
  attempt(name + ": a parameter property", () => {
    const made = new ByParameter(value, 0.5);
    return [typeof made.item, made.item.length, made.weight];
  });
  attempt(name + ": a static field", () => {
    Registry.latest = value;
    return [typeof Registry.latest, Registry.size()];
  });
  attempt(name + ": a member of a literal", () => {
    const box: { first: number; item: HasLength; last: number } = { first: 1, item: value, last: 2 };
    return [box.first, typeof box.item, box.item.length, box.last];
  });
}
attempt("a field that starts as a string", () => {
  const made = new StartsAsAString();
  const seen = [made.before, typeof made.item, made.item.length, made.after];
  made.item = { length: 77 };
  return [...seen, typeof made.item, made.item.length, made.before, made.after];
});
attempt("keys and JSON of a shelf that holds a string", () => [Object.keys(new Shelf("ab")), JSON.stringify(new Shelf("ab"))]);
