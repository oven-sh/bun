function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Reading {
  low: number = 1.5;
  declare middle: number;
  high: number = 3.5;
  private declare hidden: number;
  declare readonly fixed: number;
  last: number = 4;
  spread(): number {
    return this.high - this.low;
  }
  average(): number {
    return (this.low + this.middle + this.high) / 3;
  }
  secret(): number {
    return this.hidden;
  }
  setSecret(n: number): void {
    this.hidden = n;
  }
  parts(): unknown[] {
    return [this.low, this.middle, this.high, this.hidden, this.fixed, this.last];
  }
}

function middleOf(reading: Reading): number {
  return reading.middle;
}

const bare = new Reading();
show("parts", () => bare.parts());
show("the made ones", () => [bare.low, bare.high, bare.last, bare.spread()]);
show("the declared one", () => [bare.middle, typeof bare.middle, middleOf(bare)]);
show("average", () => bare.average());
show("the private one", () => bare.secret());
show("the readonly one", () => [bare.fixed, bare.fixed + 1]);
show("keys", () => Object.keys(bare));
show("JSON", () => JSON.stringify(bare));
show("values", () => Object.values(bare));
show("entries", () => Object.entries(bare));

const full = new Reading();
full.middle = 2.5;
full.setSecret(9);
show("filled: parts", () => full.parts());
show("filled: average", () => full.average());
show("filled: keys", () => Object.keys(full));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += middleOf(full) + full.average() + full.secret();
show("2000 filled", () => sum);
show("then a bare one", () => [middleOf(new Reading()), new Reading().average(), new Reading().secret()]);

const list: Reading[] = [full, bare, full];
show("the middle of three", () => list.map(middleOf));
show("as doubles", () => Array.from(Float64Array.from(list, middleOf)));
show("the largest", () => Math.max(...list.map(middleOf)));
show("copied field by field", () => {
  const copy = new Reading();
  copy.middle = bare.middle;
  return [copy.middle, Object.keys(copy), JSON.stringify(copy)];
});
