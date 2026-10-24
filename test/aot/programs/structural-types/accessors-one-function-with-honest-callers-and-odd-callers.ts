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

class Measured {
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
}

class WriteOnly {
  got = 0;
  set size(value: number) {
    this.got = value;
  }
}

class Echo {
  kept: number | string = 1;
  get size(): number {
    if (typeof this.kept === "number") return this.kept;
    return this.parse();
  }
  set size(value: number | string) {
    this.kept = value;
  }
  parse(): number {
    const box: { n: number } = { n: 0 };
    const wide: { n: number | string } = box;
    wide.n = this.kept;
    return box.n;
  }
}

function grow(s: Sized): unknown {
  s.size = "grown";
  const size = s.size;
  return [size, size + 1, size * 2];
}

function firstHonestCaller(): unknown {
  return grow(new Measured());
}

function secondHonestCaller(): unknown {
  let last: unknown = null;
  for (let i = 0; i < 2000; i++) last = grow(new Measured());
  return last;
}

const table = { grow };

attempt("the first honest caller", firstHonestCaller);
attempt("the second honest caller", secondHonestCaller);
attempt("a caller with a plain number field", () => {
  const p = new Plain();
  return [grow(p), p.size, p.size + 1];
});
attempt("a caller with a member that has only a setter", () => {
  const w = new WriteOnly();
  return [grow(w), w.got];
});
attempt("a caller whose getter hands back what was stored", () => grow(new Echo()));
attempt("a caller with a literal", () => grow({ size: 1 }));
attempt("a caller with a proxy", () => grow(new Proxy(new Measured(), {})));
attempt("a caller with a proxy of a plain field", () => grow(new Proxy(new Plain(), {})));
attempt("through call", () => grow.call(undefined, new Plain()));
attempt("through a member", () => table.grow(new Plain()));
attempt("through map", () => [new Measured(), new Plain(), new Measured()].map(grow));
attempt("the first honest caller again", firstHonestCaller);
