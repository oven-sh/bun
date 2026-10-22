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

export {};

async function attemptAsync(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    console.log(label + ": " + text(await run()));
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

class Holder {
  shape: Shape = new Square();
  leaf: Square | null = new Square();
  mode: "on" | "off" = "on";
  count: number | bigint = 1;
  run: (() => number) | Square = () => 3;
}

function spoil(h: Holder): void {
  h.shape = new Shape();
  h.leaf = null;
  h.mode = "off";
  h.count = 5n;
  h.run = new Square();
}

const uses: [string, (h: Holder) => Promise<unknown>][] = [
  ["two classes", async h => {
    if (h.shape instanceof Square) {
      await null;
      return [h.shape.edge, h.shape.edge * 2, h.shape.sides];
    }
    return "other";
  }],
  ["a class or null", async h => {
    if (h.leaf !== null) {
      await null;
      return h.leaf.edge;
    }
    return "other";
  }],
  ["a literal", async h => {
    if (h.mode === "on") {
      await null;
      return [h.mode, h.mode === "on"];
    }
    return "other";
  }],
  ["a number or a bigint", async h => {
    if (typeof h.count === "number") {
      await null;
      return [h.count, -h.count];
    }
    return "other";
  }],
  ["a number or a bigint, added to", async h => {
    if (typeof h.count === "number") {
      await null;
      return h.count + 1;
    }
    return "other";
  }],
  ["a function or an object", async h => {
    if (typeof h.run === "function") {
      await null;
      return h.run();
    }
    return "other";
  }],
  ["the await is inside the expression", async h => (h.shape instanceof Square ? [await null, h.shape.edge] : "other")],
  ["read before and after the await in one sum", async h => (typeof h.count === "number" ? [h.count + Number(await 1), typeof h.count] : "other")],
  ["a condition kept in a constant", async h => {
    const s = h.shape;
    const isSquare = s instanceof Square;
    await null;
    return isSquare ? [s.edge, h.shape instanceof Square] : "other";
  }],
  ["for await", async h => {
    const seen: unknown[] = [];
    if (h.shape instanceof Square) {
      for await (const n of [1, 2]) seen.push(h.shape.edge);
    }
    return seen;
  }],
];

for (const [name, use] of uses) await attemptAsync("honest: " + name, () => use(new Holder()));
for (let i = 0; i < 500; i++) for (const [, use] of uses) await use(new Holder());
for (const [name, use] of uses) {
  await attemptAsync("stored to during the await: " + name, () => {
    const h = new Holder();
    const running = use(h);
    spoil(h);
    return running;
  });
}
for (const [name, use] of uses) {
  await attemptAsync("stored to by a reaction queued first: " + name, () => {
    const h = new Holder();
    Promise.resolve().then(() => spoil(h));
    return use(h);
  });
}
for (const [name, use] of uses) await attemptAsync("honest again: " + name, () => use(new Holder()));
