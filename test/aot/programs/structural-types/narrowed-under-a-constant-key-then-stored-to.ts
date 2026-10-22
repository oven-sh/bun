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

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

const mark = Symbol("mark");

class Cell {
  value: number | string = 1;
  shape: Shape = new Square();
  [mark]: number | string = 1;
  7: number | string = 1;
}

type Between = (c: Cell) => void;
const keep: Between = () => {};
const spoil: Between = c => {
  c.value = "text";
  c.shape = new Shape();
  c[mark] = "text";
  c[7] = "text";
};

const uses: [string, (c: Cell, between: Between) => unknown][] = [
  ["a constant string key", (c, between) => {
    const key = "value";
    if (typeof c[key] === "number") {
      between(c);
      return [c[key], c[key] + 1, c[key] * 2, c.value];
    }
    return "other";
  }],
  ["a literal key in brackets", (c, between) => {
    if (typeof c["value"] === "number") {
      between(c);
      return [c["value"], c["value"] + 1, c.value + 1];
    }
    return "other";
  }],
  ["tested with a dot, read with brackets", (c, between) => {
    if (typeof c.value === "number") {
      between(c);
      return [c["value"] + 1];
    }
    return "other";
  }],
  ["a constant key to a class", (c, between) => {
    const key = "shape";
    if (c[key] instanceof Square) {
      between(c);
      return [c[key].edge, c[key].edge * 2, c[key].sides];
    }
    return "other";
  }],
  ["a symbol key", (c, between) => {
    if (typeof c[mark] === "number") {
      between(c);
      return [c[mark], c[mark] + 1, c[mark] * 2];
    }
    return "other";
  }],
  ["a numeric key", (c, between) => {
    if (typeof c[7] === "number") {
      between(c);
      return [c[7], c[7] + 1, c[7] * 2];
    }
    return "other";
  }],
];

function underAParameter(record: Record<string, number | string>, key: string, really: boolean): unknown {
  const change = (): void => {
    if (really) record[key] = "text";
  };
  if (typeof record[key] === "number") {
    change();
    return [record[key], record[key] + 1, record[key] * 2];
  }
  return "other";
}

function underAnIndex(list: (number | string)[], index: number, really: boolean): unknown {
  const change = (): void => {
    if (really) list[index] = "text";
  };
  if (typeof list[index] === "number") {
    change();
    return [list[index], list[index] + 1, list[index] * 2];
  }
  return "other";
}

function underAKeyOfAClass(c: Cell, key: "value" | 7, between: Between): unknown {
  if (typeof c[key] === "number") {
    between(c);
    return [c[key], c[key] + 1, c[key] * 2];
  }
  return "other";
}

function round(label: string, between: Between, really: boolean): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Cell(), between));
  attempt(label + ": a key that is a parameter", () => underAParameter({ a: 1, b: 2 }, "b", really));
  attempt(label + ": an index that is a parameter", () => underAnIndex([1, 2, 3], 1, really));
  attempt(label + ": one of two keys of a class", () => [underAKeyOfAClass(new Cell(), "value", between), underAKeyOfAClass(new Cell(), 7, between)]);
}

round("honest", keep, false);
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use(new Cell(), keep);
  underAParameter({ a: 1, b: 2 }, "b", false);
  underAnIndex([1, 2, 3], 1, false);
  underAKeyOfAClass(new Cell(), "value", keep);
}
round("stored to", spoil, true);
round("honest again", keep, false);
