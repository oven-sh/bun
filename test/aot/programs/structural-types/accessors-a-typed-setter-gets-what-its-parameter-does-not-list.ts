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

const seen: string[] = [];

class Narrow {
  kept = 0;
  get v(): number {
    return this.kept;
  }
  set v(value: number) {
    seen.push(typeof value);
    this.kept = value * 2;
  }
}

class Adds {
  kept = 0;
  get v(): number {
    return this.kept;
  }
  set v(value: number) {
    seen.push(typeof value);
    this.kept = value + 1;
  }
}

class TakesText {
  kept = "";
  get v(): number {
    return this.kept.length;
  }
  set v(value: string) {
    seen.push(typeof value);
    this.kept = value + "!";
  }
}

interface Wide {
  get v(): number;
  set v(value: number | string | null);
}

function store(w: Wide, value: number | string | null): unknown {
  w.v = value;
  return w.v;
}

function storeANumber(o: { v: number }, value: number): unknown {
  o.v = value;
  return o.v;
}

attempt("honest: a number for a setter of numbers", () => [store(new Narrow(), 4), store(new Adds(), 4)]);
for (let i = 0; i < 2000; i++) {
  store(new Narrow(), i);
  store(new Adds(), i);
}
seen.length = 0;
attempt("a string for a setter that multiplies", () => {
  const n = new Narrow();
  return [store(n, "text"), n.kept, n.v + 1];
});
attempt("a numeric string for a setter that multiplies", () => {
  const n = new Narrow();
  return [store(n, "21"), n.kept, n.v + 1];
});
attempt("a string for a setter that adds", () => {
  const a = new Adds();
  return [store(a, "text"), a.kept, a.v + 1, a.v * 2];
});
attempt("null for a setter that adds", () => {
  const a = new Adds();
  return [store(a, null), a.kept];
});
attempt("a number for a setter of strings", () => {
  const t = new TakesText();
  return [storeANumber(t, 12), t.kept, typeof t.kept];
});
attempt("Reflect.set hands over an object", () => {
  const a = new Adds();
  return [Reflect.set(a, "v", { valueOf: () => 9 }), a.kept, a.v];
});
attempt("Object.assign hands over a boolean", () => {
  const a = new Adds();
  Object.assign(a, { v: true });
  return [a.kept, a.v];
});
attempt("Object.assign hands over undefined", () => {
  const n = new Narrow();
  Object.assign(n, { v: undefined });
  return [n.kept, n.v];
});
console.log("what the setters saw: " + seen.join());
attempt("honest again", () => [store(new Narrow(), 4), store(new Adds(), 4)]);
