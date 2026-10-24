function attempt(label: string, body: () => unknown): void {
  try {
    const value = body();
    console.log(label + ": " + typeof value + " " + (Object.is(value, -0) ? "-0" : String(value)));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Gauge {
  level: number;
}

class Meter {
  level = 1;
  other = 2;
}

function fromSetterOnly(): number {
  const g: Gauge = { set level(value: number) {} };
  return g.level;
}

function fromDeleted(): number {
  const g = { level: 1 };
  const loose: { level?: number } = g;
  delete loose.level;
  return g.level;
}

function fromDeletedField(): number {
  const m = new Meter();
  const loose: { level?: number } = m;
  delete loose.level;
  return m.level;
}

function fromSpread(): number {
  const given: Partial<Gauge> = { level: undefined };
  const merged: Gauge = { level: 1, ...given };
  return merged.level;
}

function fromStoredUndefined(): number {
  const m = new Meter();
  const loose: { level?: number } = m;
  loose.level = undefined;
  return m.level;
}

function fromRecord(): number {
  const scores: Record<string, number> = { a: 1 };
  return scores["b"];
}

function fromBarePrototype(): number {
  const m: Meter = Object.create(Meter.prototype);
  return m.level;
}

function addOne(n: number): number {
  return n + 1;
}

function truncate(n: number): number {
  return n | 0;
}

function double(n: number): number {
  return n * 2;
}

function same(n: number): number {
  return n;
}

function withDefault(n: number = 5): number {
  return n;
}

function compare(n: number): string {
  return [n < 1, n > 1, n === 0, n == 0, n !== n, n === undefined].join();
}

function sumTo(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += i;
  return total;
}

class Holder {
  n = 0;
  list: number[] = [1.5];
  set(n: number): this {
    this.n = n;
    this.list.push(n);
    return this;
  }
}

const sources: [string, () => number][] = [
  ["an honest number", () => 3],
  ["a member with only a setter", fromSetterOnly],
  ["a deleted member", fromDeleted],
  ["a deleted field of a class", fromDeletedField],
  ["an undefined spread over it", fromSpread],
  ["an undefined stored through a view", fromStoredUndefined],
  ["a key that a record lacks", fromRecord],
  ["an object with only the prototype", fromBarePrototype],
];

for (let i = 0; i < 2000; i++) {
  addOne(i);
  truncate(i);
  double(i + 0.5);
  same(i);
  new Holder().set(i);
}

for (const [label, source] of sources) {
  attempt(label + ", itself", source);
  attempt(label + ", handed on", () => same(source()));
  attempt(label + ", plus one", () => addOne(source()));
  attempt(label + ", truncated", () => truncate(source()));
  attempt(label + ", doubled", () => double(source()));
  attempt(label + ", a default parameter", () => withDefault(source()));
  attempt(label + ", compared", () => compare(source()));
  attempt(label + ", a loop bound", () => sumTo(source()));
  attempt(label + ", a method of the number", () => source().toFixed(1));
  attempt(label + ", Math.floor", () => Math.floor(source()));
  attempt(label + ", Math.max", () => Math.max(source(), 1));
  attempt(label + ", Number.isInteger", () => Number.isInteger(source()));
  attempt(label + ", isNaN", () => isNaN(source()));
  attempt(label + ", text", () => `${source()}` + source());
  attempt(label + ", an index", () => [10, 20, 30, 40][source()]);
  attempt(label + ", a typed array", () => new Float64Array([source()])[0]);
  attempt(label + ", an integer array", () => new Int32Array([source()])[0]);
  attempt(label + ", a field", () => new Holder().set(source()).n);
  attempt(label + ", a field as json", () => JSON.stringify(new Holder().set(source())));
  attempt(label + ", a list", () => {
    const list: number[] = [1, 2];
    list.push(source());
    list[0] = source();
    return list.map(n => typeof n).join() + " " + list.reduce((a, b) => a + b, 0);
  });
  attempt(label + ", a literal", () => JSON.stringify({ n: source() }) + Object.keys({ n: source() }).join());
  attempt(label + ", a switch", () => {
    switch (source()) {
      case 3:
        return "three";
      case 0:
        return "zero";
      default:
        return "default";
    }
  });
  attempt(label + ", truthiness", () => (source() ? "truthy" : "falsy"));
  attempt(label + ", ??", () => source() ?? "nullish");
}

export {};
