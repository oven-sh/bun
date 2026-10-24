function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

function* plain(): Generator<number, string, void> {
  let step = 1;
  yield step++;
  yield step++;
  console.log("plain: never printed after a return");
  return "end " + step;
}

function* guarded(): Generator<number, string, void> {
  let step = 1;
  try {
    yield step++;
    yield step++;
    return "try " + step;
  } finally {
    console.log("guarded: finally at step " + step);
  }
}

function* overriding(): Generator<number, string, void> {
  try {
    yield 1;
    return "try";
  } finally {
    return "finally wins";
  }
}

function* throwing(): Generator<number, string, void> {
  try {
    yield 1;
    return "try";
  } finally {
    throw new RangeError("from finally");
  }
}

function* nested(): Generator<number, string, void> {
  try {
    try {
      yield 1;
    } finally {
      console.log("nested: inner finally");
    }
    console.log("nested: between, never printed after a return");
    yield 2;
  } finally {
    console.log("nested: outer finally");
  }
  return "end";
}

function* catching(): Generator<number, string, void> {
  try {
    yield 1;
  } catch (error) {
    console.log("catching: a return is not caught, never printed");
  }
  return "end";
}

const makers: [string, () => Generator<number, string, void>][] = [
  ["plain", plain],
  ["guarded", guarded],
  ["overriding", overriding],
  ["throwing", throwing],
  ["nested", nested],
  ["catching", catching],
];

for (const [label, make] of makers) {
  const g = make();
  attempt(label + " next", () => g.next());
  attempt(label + " return", () => g.return("asked"));
  attempt(label + " next after it", () => g.next());
  attempt(label + " return after it", () => g.return("again"));

  const length = make();
  length.next();
  attempt(label + " length of the returned text", () => {
    const result = length.return("four");
    return result.done ? result.value.length : -result.value;
  });

  let seen = 0;
  attempt(label + " left by a break", () => {
    for (const n of make()) {
      seen += n;
      break;
    }
    return seen;
  });
}
