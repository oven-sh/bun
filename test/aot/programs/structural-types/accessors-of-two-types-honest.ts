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

class Box {
  kept = 1;
  get size(): number {
    return this.kept;
  }
  set size(value: number | string) {
    this.kept = typeof value === "string" ? value.length : value;
  }
}

class Meter {
  static total = 0;
  static get reading(): number {
    return Meter.total;
  }
  static set reading(value: number | string) {
    Meter.total += typeof value === "string" ? value.length : value;
  }
}

const literal = {
  kept: 1,
  get size(): number {
    return this.kept;
  },
  set size(value: number | string) {
    this.kept = typeof value === "string" ? value.length : value;
  },
};

interface Sized {
  get size(): number;
  set size(value: number | string);
}

function fill(s: Sized, value: number | string): number {
  s.size = value;
  return s.size;
}

let sum = 0;
const box = new Box();
for (let i = 0; i < 4000; i++) {
  box.size = i % 2 === 0 ? i : "abc";
  sum += box.size;
  box.size += 1;
  box.size++;
  sum += box.size;
  literal.size = i % 3 === 0 ? "ab" : i;
  sum += literal.size;
  Meter.reading = i % 5 === 0 ? "abcd" : 1;
  sum += fill(box, i) + fill(literal, "abcde");
}
console.log("the total of 4000 rounds: " + sum);
console.log("the meter: " + Meter.reading);
attempt("the box", () => [box.size, box.kept, Object.keys(box).join()]);
attempt("the literal", () => [literal.size, literal.kept, JSON.stringify(literal)]);
attempt("a fresh box", () => {
  const b = new Box();
  return [fill(b, "four"), b.size, (b.size += 1), b.size++, b.size];
});
