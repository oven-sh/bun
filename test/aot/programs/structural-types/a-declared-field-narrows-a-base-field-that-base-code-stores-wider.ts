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

class Cell {
  value: number | string = "start";
  put(value: number | string): void {
    this.value = value;
  }
  reset(): void {
    this.value = "reset";
  }
}

class NumberCell extends Cell {
  declare value: number;
  twice(): number {
    return this.value * 2;
  }
  next(): number {
    return this.value + 1;
  }
  whole(): number {
    return this.value | 0;
  }
  fixed(): string {
    return this.value.toFixed(1);
  }
}

function valueOf(cell: NumberCell): number {
  return cell.value;
}

function all(label: string, cell: NumberCell): void {
  show(label + ": read", () => cell.value);
  show(label + ": through a function", () => valueOf(cell));
  show(label + ": twice", () => cell.twice());
  show(label + ": next", () => cell.next());
  show(label + ": whole", () => cell.whole());
  show(label + ": fixed", () => cell.fixed());
  show(label + ": keys", () => Object.keys(cell));
}

all("as the base class made it", new NumberCell());

const honest = new NumberCell();
honest.value = 2.5;
all("after an honest store", honest);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  honest.value = i;
  sum += valueOf(honest) + honest.twice() + honest.next();
}
show("2000 honest rounds", () => sum);

honest.put("7");
all("after the base class stored a string", honest);
honest.put(8);
all("after the base class stored a number", honest);
honest.reset();
all("after the base class reset it", honest);

const wide: Cell = honest;
wide.value = "wide";
all("after a store through the base type", honest);

show("in a loop where the base class steps in", () => {
  const cell = new NumberCell();
  const seen: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    cell.value = i;
    if (i === 2) cell.reset();
    seen.push(cell.next());
  }
  return seen;
});
