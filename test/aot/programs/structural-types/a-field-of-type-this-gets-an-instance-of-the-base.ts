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

class Link {
  next: this | null = null;
  weight = 1;
  total(): number {
    let sum = 0;
    for (let at: Link | null = this; at !== null; at = at.next) sum += at.weight;
    return sum;
  }
}

class NamedLink extends Link {
  name: string;
  size: number;
  constructor(name: string, size: number) {
    super();
    this.name = name;
    this.size = size;
  }
  names(): string {
    let text = "";
    for (let at: NamedLink | null = this; at !== null; at = at.next) text += at.name.toUpperCase();
    return text;
  }
  sizes(): number {
    let sum = 0;
    for (let at: NamedLink | null = this; at !== null; at = at.next) sum += at.size;
    return sum;
  }
}

function append(head: Link, tail: Link): void {
  head.next = tail;
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const a = new NamedLink("a", i);
  a.next = new NamedLink("b", 0.5);
  total += a.names().length + a.sizes() + a.total();
}
console.log("2000 honest rounds: " + total);

const head = new NamedLink("head", 1);
append(head, new NamedLink("tail", 2));
attempt("an honest chain", () => [head.names(), head.sizes(), head.total()]);

append(head, new Link());
console.log("the next one is an instance of the base: " + JSON.stringify(head) + " " + (head.next instanceof NamedLink));
attempt("total", () => head.total());
attempt("sizes", () => head.sizes());
attempt("names", () => head.names());
attempt("next.name", () => (head.next === null ? "none" : head.next.name));
attempt("typeof next.size", () => (head.next === null ? "none" : typeof head.next.size));
attempt("next.size + 1", () => (head.next === null ? -1 : head.next.size + 1));
attempt("next.names()", () => (head.next === null ? "none" : head.next.names()));
attempt("keys of next", () => (head.next === null ? [] : Object.keys(head.next)));

const literal: Link = { next: null, weight: 5, total: () => 0 };
append(head, literal);
console.log("the next one is a literal: " + JSON.stringify(head));
attempt("total", () => head.total());
attempt("sizes", () => head.sizes());
attempt("names", () => head.names());

append(head, new NamedLink("again", 3));
attempt("honest again", () => [head.names(), head.sizes(), head.total()]);

export {};
