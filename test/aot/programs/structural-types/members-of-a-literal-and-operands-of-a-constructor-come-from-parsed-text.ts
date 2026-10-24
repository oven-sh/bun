interface Point {
  x: number;
  y: number;
}

interface Named {
  name: string;
  at: Point;
  tags: string[];
}

class Pixel {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

class Labeled extends Pixel {
  label: string;
  constructor(x: number, label: string) {
    super(x, JSON.parse("[2]"));
    this.label = label;
  }
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function literal(text: string): Point {
  return { x: JSON.parse(text), y: 2 };
}

function literalBoth(text: string): Point {
  const [x, y] = JSON.parse(text);
  return { x, y };
}

function pixel(text: string): Pixel {
  return new Pixel(JSON.parse(text), 2);
}

function named(text: string): Named {
  const data = JSON.parse(text);
  return { name: data.name, at: { x: data.x, y: data.y }, tags: data.tags };
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(literal("1")) + sum(literalBoth("[1,2]")) + pixel("1").sum() + named('{"name":"n","x":1,"y":2,"tags":["t"]}').at.x;
console.log("2000 honest rounds: " + warm);

for (const text of ["1", "1.5", "-0", "1e400", '"1"', '""', "true", "null", "[1]", "[]", "{}", '{"valueOf":1}']) {
  attempt("a member of a literal is " + text, () => {
    const p = literal(text);
    return [p.x, typeof p.x, p.x + 1, sum(p), JSON.stringify(p), Object.keys(p).join()];
  });
  attempt("an operand of a constructor is " + text, () => {
    const p = pixel(text);
    return [p.x, typeof p.x, p.x * 2, p.sum(), JSON.stringify(p)];
  });
  attempt("stored over afterwards, " + text, () => {
    const p = literal(text);
    p.x = 5;
    const q = pixel(text);
    q.x = 6;
    return [sum(p), q.sum()];
  });
}

for (const text of ["[1,2]", '["1",2]', '[1,"2"]', "[1]", "[]", "[null,null]", "[[1],[2]]", '"ab"']) {
  attempt("both members come from " + text, () => {
    const p = literalBoth(text);
    return [p.x, p.y, sum(p), JSON.stringify(p), "y" in p];
  });
}
attempt("both members come from {}", () => literalBoth("{}"));

for (const text of [
  '{"name":"n","x":1,"y":2,"tags":["t"]}',
  '{"name":5,"x":"1","y":"2","tags":"t"}',
  '{"name":null,"tags":null}',
  '{"name":["n"],"x":[1],"y":[2],"tags":{"length":1,"0":"t"}}',
  "{}",
]) {
  attempt("a literal inside a literal, " + text, () => {
    const n = named(text);
    return [n.name + "!", sum(n.at), JSON.stringify(n)];
  });
  attempt("its text and its list, " + text, () => {
    const n = named(text);
    return [n.name.length, n.tags.length, n.tags[0]];
  });
}

attempt("super gets a list for a number", () => {
  const l = new Labeled(1, "l");
  return [l.y, typeof l.y, l.sum(), JSON.stringify(l)];
});
attempt("a subclass gets a number for its text", () => {
  const l = new Labeled(JSON.parse('"1"'), JSON.parse("7"));
  return [l.x, l.label, l.label + 1, l.sum()];
});

console.log("honest again: " + [sum(literal("1")), pixel("1").sum()].join(" "));

export {};
