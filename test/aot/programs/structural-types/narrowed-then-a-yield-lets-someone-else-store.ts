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

class Holder {
  shape: Shape = new Square();
  leaf: Square | null = new Square();
  mode: "on" | "off" = "on";
  value: number | string = 1;
}

function spoil(h: Holder): void {
  h.shape = new Shape();
  h.leaf = null;
  h.mode = "off";
  h.value = "text";
}

function* twoClasses(h: Holder): Generator<string, unknown, void> {
  if (h.shape instanceof Square) {
    yield "paused";
    return [h.shape.edge, h.shape.edge * 2, h.shape.sides];
  }
  return "other";
}

function* classOrNull(h: Holder): Generator<string, unknown, void> {
  if (h.leaf !== null) {
    yield "paused";
    return h.leaf.edge;
  }
  return "other";
}

function* literal(h: Holder): Generator<string, unknown, void> {
  if (h.mode === "on") {
    yield "paused";
    return [h.mode, h.mode === "on"];
  }
  return "other";
}

function* numberOrString(h: Holder): Generator<string, unknown, void> {
  if (typeof h.value === "number") {
    yield "paused";
    return [h.value, h.value + 1, h.value * 2];
  }
  return "other";
}

function* aLocal(h: Holder): Generator<() => void, unknown, void> {
  let v: number | string = 1;
  if (typeof v === "number") {
    yield () => {
      v = "text";
    };
    return [v, v + 1, v * 2];
  }
  return "other";
}

function* yieldsTheNarrowedValue(h: Holder): Generator<number, unknown, void> {
  while (typeof h.value === "number" && h.value < 3) {
    yield h.value;
    h.value++;
  }
  return h.value;
}

function* delegates(h: Holder): Generator<string, unknown, void> {
  if (h.shape instanceof Square) {
    yield* ["first", "second"];
    return h.shape.edge;
  }
  return "other";
}

function* inFinally(h: Holder): Generator<string, unknown, void> {
  if (h.shape instanceof Square) {
    try {
      yield "paused";
    } finally {
      console.log("  in finally: " + text(h.shape.edge));
    }
  }
  return "done";
}

const makers: [string, (h: Holder) => Generator<unknown, unknown, void>][] = [
  ["two classes", twoClasses],
  ["a class or null", classOrNull],
  ["a literal", literal],
  ["a number or a string", numberOrString],
  ["delegating", delegates],
  ["in finally", inFinally],
];

function drain(g: Generator<unknown, unknown, void>, atFirstPause: () => void): unknown {
  let step = g.next();
  let first = true;
  while (!step.done) {
    if (first) atFirstPause();
    first = false;
    step = g.next();
  }
  return step.value;
}

for (const [name, make] of makers) attempt("honest: " + name, () => drain(make(new Holder()), () => {}));
for (let i = 0; i < 2000; i++) for (const [name, make] of makers) if (name !== "in finally") drain(make(new Holder()), () => {});
for (const [name, make] of makers) {
  attempt("stored to during the pause: " + name, () => {
    const h = new Holder();
    return drain(make(h), () => spoil(h));
  });
}
attempt("a local changed by what was yielded", () => {
  const g = aLocal(new Holder());
  const step = g.next();
  if (!step.done) step.value();
  return g.next().value;
});
attempt("a local left alone", () => {
  const g = aLocal(new Holder());
  g.next();
  return g.next().value;
});
attempt("the narrowed value is yielded and then incremented", () => {
  const h = new Holder();
  const g = yieldsTheNarrowedValue(h);
  const seen: unknown[] = [g.next().value];
  h.value = "text";
  seen.push(g.next().value, h.value);
  return seen;
});
attempt("returned from during the pause", () => {
  const h = new Holder();
  const g = inFinally(h);
  g.next();
  spoil(h);
  return g.return("left early").value;
});
for (const [name, make] of makers) attempt("honest again: " + name, () => drain(make(new Holder()), () => {}));
