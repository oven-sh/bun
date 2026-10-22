function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

function parse<T = number>(text: string): T {
  return JSON.parse(text);
}

interface Config {
  port: number;
  host: string;
}

function load<T = Config>(text: string): T {
  return JSON.parse(text);
}

class Cell<T = number> {
  value: T;
  constructor(text: string) {
    this.value = JSON.parse(text);
  }
}

function address(c: Config): string {
  return c.host.toLowerCase() + ":" + (c.port + 1);
}

function next(cell: Cell): number {
  return cell.value + 1;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += parse(String(i)) + address(load('{"port":' + i + ',"host":"H"}')).length + next(new Cell(String(i)));
console.log("2000 honest rounds: " + total);

for (const text of ["1", "1.5", "-0", "1e400", '"text"', "null", "true", "[1]", '{"a":1}']) {
  console.log("parsed from " + text);
  attempt("  typeof", () => typeof parse(text));
  attempt("  + 1", () => parse(text) + 1);
  attempt("  * 2", () => parse(text) * 2);
  attempt("  | 0", () => parse(text) | 0);
  attempt("  toFixed(1)", () => parse(text).toFixed(1));
  attempt("  a local", () => {
    const n = parse(text);
    return n - n;
  });
  attempt("  a cell", () => next(new Cell(text)));
  attempt("  a cell's JSON", () => JSON.stringify(new Cell(text)));
}

for (const text of ['{"port":80,"host":"A"}', '{"host":"A","port":80}', '{"port":"80","host":"A"}', '{"port":80,"host":5}', '{"port":80}', "{}", "[]", "null", "5", '{"port":80,"host":"A","more":1}']) {
  console.log("loaded from " + text);
  attempt("  address", () => address(load(text)));
  attempt("  port", () => load(text).port);
  attempt("  keys", () => Object.keys(load<object>(text)));
}

attempt("another type argument", () => parse<string>('"text"').toUpperCase());
attempt("another type argument, a cell", () => new Cell<string>('"text"').value.toUpperCase());

export {};
