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

class Words {
  kept: number | string = 0;
  get v(): number | string {
    return this.kept;
  }
  set v(value: number) {
    this.kept = value === 0 ? "zero" : value < 0 ? "negative" : value;
  }
}

class Leaf {
  weight = 7;
}

class Loses {
  kept: Leaf | null = null;
  get leaf(): Leaf | null {
    return this.kept;
  }
  set leaf(value: Leaf) {
    this.kept = value.weight > 5 ? null : value;
  }
}

class Flips {
  kept: "on" | "off" = "off";
  get mode(): "on" | "off" {
    return this.kept;
  }
  set mode(value: "on") {
    this.kept = this.kept === "on" ? "off" : "on";
  }
}

function half(n: number): number {
  return n / 2;
}

attempt("an honest store", () => {
  const w = new Words();
  w.v = 5;
  return [w.v, w.v + 1, w.v * 2, half(w.v), w.v.toFixed(1)];
});
let sum = 0;
const shared = new Words();
for (let i = 1; i <= 2000; i++) {
  shared.v = i;
  sum += shared.v;
}
console.log("2000 honest stores: " + sum);
attempt("zero comes back as a word", () => {
  const w = new Words();
  w.v = 0;
  return [w.v, w.v + 1, w.v * 2, half(w.v)];
});
attempt("zero comes back as a word, a method of numbers", () => {
  const w = new Words();
  w.v = 0;
  return w.v.toFixed(1);
});
attempt("at the site of the 2000 stores", () => {
  shared.v = -1;
  sum += shared.v;
  return sum;
});
attempt("kept in a constant", () => {
  const w = new Words();
  w.v = 0;
  const n: number = w.v;
  return [n, n - 1];
});
attempt("the value of the store itself", () => {
  const w = new Words();
  const n = (w.v = 0);
  return [n, n + 1];
});
attempt("an object comes back as null", () => {
  const l = new Loses();
  l.leaf = new Leaf();
  return l.leaf;
});
attempt("an object comes back as null, a member", () => {
  const l = new Loses();
  l.leaf = new Leaf();
  return l.leaf.weight;
});
attempt("a literal comes back as the other one", () => {
  const f = new Flips();
  f.mode = "on";
  const first: "on" = f.mode;
  f.mode = "on";
  const second: "on" = f.mode;
  return [first, second, second === "on"];
});
attempt("an honest store again", () => {
  const w = new Words();
  w.v = 5;
  return [w.v, w.v + 1];
});
