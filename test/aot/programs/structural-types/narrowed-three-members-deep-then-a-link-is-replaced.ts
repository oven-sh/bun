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

class Inner {
  value: number | string = 1;
  shape: Shape = new Square();
}

class TextInner extends Inner {
  value: number | string = "text";
  shape: Shape = new Shape();
}

class Middle {
  inner: Inner = new Inner();
}

class Outer {
  middle: Middle = new Middle();
}

type Between = (o: Outer) => void;
const keep: Between = () => {};
const theEnd: Between = o => {
  o.middle.inner.value = "text";
  o.middle.inner.shape = new Shape();
};
const theInner: Between = o => {
  o.middle.inner = new TextInner();
};
const theMiddle: Between = o => {
  const m = new Middle();
  m.inner = new TextInner();
  o.middle = m;
};

const uses: [string, (o: Outer, between: Between) => unknown][] = [
  ["three members deep, typeof", (o, between) => {
    if (typeof o.middle.inner.value === "number") {
      between(o);
      return [o.middle.inner.value, o.middle.inner.value + 1, o.middle.inner.value * 2];
    }
    return "other";
  }],
  ["three members deep, instanceof", (o, between) => {
    if (o.middle.inner.shape instanceof Square) {
      between(o);
      return [o.middle.inner.shape.edge, o.middle.inner.shape.edge * 2, o.middle.inner.shape.sides];
    }
    return "other";
  }],
  ["the path starts at a constant taken before", (o, between) => {
    const inner = o.middle.inner;
    if (typeof inner.value === "number") {
      between(o);
      return [inner.value, inner.value + 1, o.middle.inner.value];
    }
    return "other";
  }],
  ["tested by one path, read by another", (o, between) => {
    const middle = o.middle;
    if (typeof o.middle.inner.value === "number" && typeof middle.inner.value === "number") {
      between(o);
      return [o.middle.inner.value + 1, middle.inner.value + 1];
    }
    return "other";
  }],
  ["a store to the narrowed path", (o, between) => {
    if (typeof o.middle.inner.value === "number") {
      between(o);
      o.middle.inner.value += 1;
      return o.middle.inner.value;
    }
    return "other";
  }],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Outer(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Outer(), keep);
round("the end is stored to", theEnd);
round("the last object is replaced", theInner);
round("the middle object is replaced", theMiddle);
round("honest again", keep);
