function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

class Reader {
  lines: string[] = ["one", "two", "three"];
  read(): string;
  read(count: number): string[];
  read(count?: number): string | string[] {
    return count === undefined ? this.lines[0] : this.lines.slice(0, count);
  }
}

class Swapped extends Reader {
  read(): string;
  read(count: number): string[];
  read(count?: number): string | string[] {
    return count === undefined ? this.lines.slice(0, 2) : this.lines[count];
  }
}

class CountsArguments extends Reader {
  read(): string;
  read(count: number): string[];
  read(...given: [] | [number]): string | string[] {
    return given.length === 0 ? "nothing given" : ["given " + text(given[0])];
  }
}

class Narrow extends Reader {
  read(): string;
  read(count: number): string[];
  read(): string | string[] {
    return "always " + arguments.length;
  }
}

function first(reader: Reader): string {
  const line: string = reader.read();
  return text(line) + " | length " + text(line.length) + " | upper " + line.toUpperCase();
}

function some(reader: Reader): string {
  const lines: string[] = reader.read(2);
  return text(lines) + " | length " + text(lines.length) + " | joined " + lines.join("+");
}

function both(reader: Reader): string {
  return reader.read() + "/" + reader.read(1).length;
}

let warm = 0;
const honest = new Reader();
for (let i = 0; i < 2000; i++) warm += first(honest).length + some(honest).length;
console.log("2000 honest reads: " + warm);

const readers: [string, () => Reader][] = [
  ["the base", () => new Reader()],
  ["swapped", () => new Swapped()],
  ["counts its arguments", () => new CountsArguments()],
  ["takes no parameter", () => new Narrow()],
];

for (const [label, make] of readers) {
  attempt(label + ", first", () => first(make()));
  attempt(label + ", some", () => some(make()));
  attempt(label + ", both", () => both(make()));
}

interface Loose {
  read(count?: number): unknown;
}
for (const [label, make] of readers) {
  const loose: Loose = make();
  attempt(label + ", undefined is given", () => loose.read(undefined));
}

const list: Reader[] = readers.map(([, make]) => make());
attempt("a list of readers", () => list.map(reader => typeof reader.read() + " " + Array.isArray(reader.read(1))));
attempt("the base again", () => first(honest));
