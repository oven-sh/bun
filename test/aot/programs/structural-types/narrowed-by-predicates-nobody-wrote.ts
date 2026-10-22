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

class Circle extends Shape {
  radius = 5;
}

attempt("filter keeps the squares", () => {
  const shapes: Shape[] = [new Square(), new Circle(), new Square()];
  const squares = shapes.filter(s => s instanceof Square);
  return squares.map(s => s.edge);
});
attempt("filter drops null", () => {
  const list: (Square | null)[] = [new Square(), null, new Square()];
  const present = list.filter(s => s !== null);
  return present.map(s => s.edge);
});
attempt("filter keeps the numbers", () => {
  const list: (number | string)[] = [1, "two", 3];
  const numbers = list.filter(v => typeof v === "number");
  return numbers.map(n => n * 2);
});
attempt("find gives a square", () => {
  const shapes: Shape[] = [new Circle(), new Square()];
  const found = shapes.find(s => s instanceof Square);
  return found === undefined ? "none" : found.edge;
});
attempt("every narrows the array, then an alias pushes a circle", () => {
  const shapes: Shape[] = [new Square()];
  const alias = shapes;
  if (shapes.every(s => s instanceof Square)) {
    alias.push(new Circle());
    alias.push(new Shape());
    return shapes.map(s => [s.edge, s.edge * 2, s.sides]);
  }
  return "not all squares";
});
attempt("every narrows the array, then a call stores a string", () => {
  const list: (number | string)[] = [1, 2];
  const spoil = (): void => {
    list[1] = "text";
  };
  if (list.every(v => typeof v === "number")) {
    spoil();
    return [list[0] + 1, list[1] + 1, list[1] * 2, list.reduce((a, b) => a + b, 0)];
  }
  return "not all numbers";
});
attempt("every is true of an empty array", () => {
  const shapes: Shape[] = [];
  if (shapes.every(s => s instanceof Square)) {
    shapes.length = 1;
    const first: Square = shapes[0];
    return [typeof first, 0 in shapes];
  }
  return "not all squares";
});
attempt("every skips holes", () => {
  const list: (number | string)[] = [1, 2, 3];
  delete list[1];
  if (list.every(v => typeof v === "number")) return [list[1], list[1] + 1, 1 in list];
  return "not all numbers";
});
attempt("the callback changes what it already let through", () => {
  const cells: { value: number | string }[] = [{ value: 1 }, { value: 2 }];
  const values: (number | string)[] = [1, 2, 3];
  const kept = values.filter((v, i) => {
    if (i === 2) cells[0].value = "text";
    return typeof v === "number";
  });
  return [kept, cells[0].value];
});
attempt("an element with a getter that alternates", () => {
  const list: (number | string)[] = [0, 2];
  let reads = 0;
  Object.defineProperty(list, 0, { get: () => (reads++ % 2 === 0 ? 1 : "text"), enumerable: true, configurable: true });
  if (list.every(v => typeof v === "number")) return [list[0], list[0], list[0] + 1, list[0] + 1];
  return "not all numbers";
});
attempt("a predicate kept in a constant", () => {
  const isSquare = (s: Shape) => s instanceof Square;
  const holder: { shape: Shape } = { shape: new Square() };
  if (isSquare(holder.shape)) {
    const before = holder.shape.edge;
    [0].forEach(() => {
      holder.shape = new Circle();
    });
    return [before, holder.shape.edge, holder.shape.sides];
  }
  return "not a square";
});
