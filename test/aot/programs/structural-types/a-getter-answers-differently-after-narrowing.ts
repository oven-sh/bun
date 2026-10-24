function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.radius * 3;
    case "square":
      return s.side * s.side;
  }
}

function double(o: { readonly v: number | string }): number | string {
  return typeof o.v === "number" ? o.v * 2 : "text: " + o.v;
}

function fixed(o: { readonly v: number | string }): string {
  if (typeof o.v === "number") return o.v.toFixed(1);
  return o.v.toUpperCase();
}

function lengthOf(o: { name: string | null }): number {
  return o.name === null ? -1 : o.name.length;
}

function callIt(o: { f?: () => number }): number {
  return o.f ? o.f() : -1;
}

function alternating(): { readonly v: number | string } {
  let reads = 0;
  return {
    get v() {
      log.push("get-v");
      return reads++ % 2 === 0 ? 1 : "text";
    },
  };
}

class Flicker {
  #reads = 0;
  get v(): number | string {
    return this.#reads++ % 2 === 0 ? 1 : "text";
  }
  get name(): string | null {
    return this.#reads++ % 2 === 0 ? "name" : null;
  }
  set name(value: string | null) {}
  get f(): (() => number) | undefined {
    return this.#reads++ % 2 === 0 ? () => 5 : undefined;
  }
}

function flickeringShape(): Shape {
  let reads = 0;
  return {
    get kind(): "square" | "circle" {
      log.push("get-kind");
      return reads++ % 2 === 0 ? "square" : "circle";
    },
    radius: 2,
    side: 5,
  };
}

attempt("honest double", () => [double({ v: 2 }), double({ v: "a" })]);
attempt("honest fixed", () => [fixed({ v: 2 }), fixed({ v: "a" })]);
attempt("honest lengthOf", () => [lengthOf({ name: "ab" }), lengthOf({ name: null })]);
attempt("honest callIt", () => [callIt({ f: () => 1 }), callIt({})]);
attempt("honest area", () => [area({ kind: "circle", radius: 1 }), area({ kind: "square", side: 2 })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += Number(double({ v: i })) + fixed({ v: i }).length + lengthOf({ name: "ab" }) + callIt({ f: () => i }) + area({ kind: "square", side: i });
console.log("2000 honest rounds", warm);

attempt("a literal's getter: double", () => double(alternating()));
attempt("a literal's getter: fixed", () => fixed(alternating()));
attempt("a class's getter: double", () => double(new Flicker()));
attempt("a class's getter: fixed", () => fixed(new Flicker()));
attempt("a class's getter: lengthOf", () => lengthOf(new Flicker()));
attempt("a class's getter: callIt", () => callIt(new Flicker()));
attempt("the tag is a getter: area", () => area(flickeringShape()));
attempt("the tag is a getter: twice", () => {
  const s = flickeringShape();
  return [area(s), area(s), area(s)];
});
attempt("the tag is a getter: if", () => {
  const s = flickeringShape();
  if (s.kind === "square") return s.kind + ":" + s.side;
  return s.kind + ":" + s.radius;
});
attempt("in a field", () => {
  class Holder {
    o: { readonly v: number | string } = alternating();
    read(): number | string {
      return typeof this.o.v === "number" ? this.o.v + 1 : this.o.v + "!";
    }
  }
  return new Holder().read();
});
attempt("in an element", () => {
  const list: { readonly v: number | string }[] = [{ v: 1 }, alternating(), { v: "z" }];
  return list.map(double);
});
attempt("honest again", () => [double({ v: 2 }), fixed({ v: 2 }), lengthOf({ name: "ab" }), callIt({ f: () => 1 }), area({ kind: "circle", radius: 1 })]);
