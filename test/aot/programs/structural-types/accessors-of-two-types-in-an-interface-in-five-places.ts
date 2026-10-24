function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Sized {
  get size(): number;
  set size(value: number | string);
}

class Measured implements Sized {
  kept = 1;
  get size(): number {
    return this.kept;
  }
  set size(value: number | string) {
    this.kept = typeof value === "string" ? value.length : value;
  }
}

class Plain {
  size = 1;
  twice(): number {
    return this.size * 2;
  }
}

function fill(s: Sized, value: number | string): unknown {
  s.size = value;
  return [s.size, s.size + 1, s.size * 2];
}

class Shelf {
  item: Sized;
  constructor(item: Sized) {
    this.item = item;
  }
  fill(value: number | string): unknown {
    this.item.size = value;
    return [this.item.size, this.item.size + 1];
  }
}

function captured(s: Sized): (value: number | string) => unknown {
  return value => {
    s.size = value;
    return [s.size, s.size + 1];
  };
}

attempt("accessors, a number", () => fill(new Measured(), 4));
attempt("accessors, a string", () => fill(new Measured(), "four"));
attempt("a plain field, a number", () => fill(new Plain(), 4));
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const m = new Measured();
  const p = new Plain();
  fill(m, i);
  fill(m, "ab");
  fill(p, i);
  sum += m.size + p.size + p.twice();
}
console.log("honest rounds: " + sum);
attempt("a plain field, a string, in a parameter", () => {
  const p = new Plain();
  return [fill(p, "four"), p.size, p.size + 1, p.twice(), JSON.stringify(p)];
});
attempt("a plain field, a string, in a local", () => {
  const p = new Plain();
  const view: Sized = p;
  view.size = "four";
  return [view.size, p.size, p.size + 1, p.twice()];
});
attempt("a plain field, a string, in a field", () => {
  const p = new Plain();
  return [new Shelf(p).fill("four"), p.size, p.twice()];
});
attempt("a plain field, a string, in an element", () => {
  const plains = [new Plain(), new Plain()];
  const views: Sized[] = plains;
  views[1].size = "four";
  return plains.map(p => [p.size, p.size + 1, p.twice()]);
});
attempt("a plain field, a string, in a captured variable", () => {
  const p = new Plain();
  return [captured(p)("four"), p.size, p.twice()];
});
attempt("a literal with a number member", () => {
  const literal = { size: 1, other: 2 };
  return [fill(literal, "four"), literal.size, literal.size + 1, JSON.stringify(literal)];
});
attempt("updates through the view", () => {
  const p = new Plain();
  const view: Sized = p;
  fill(view, "4");
  view.size++;
  const first = p.size;
  fill(view, "4");
  view.size += 1;
  return [first, p.size];
});
attempt("a plain field, a number again", () => fill(new Plain(), 4));
attempt("accessors again", () => fill(new Measured(), "four"));
