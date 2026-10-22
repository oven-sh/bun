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
  area(): number {
    return this.edge * this.edge;
  }
}

class Circle extends Shape {
  radius = 5;
  area(): number {
    return this.radius * this.radius * 3;
  }
}

class Holder {
  shape: Square | Circle = new Square();
  value: number | string = 1;
  count: number | bigint = 2;
  next: Holder | null = null;
  mode: "on" | "off" = "on";
  work: (() => number) | Square = () => 3;
  point: [number] | [number, number] = [1, 2];
}

function total(h: Holder): number {
  let sum = 0;
  if (h.shape instanceof Square) sum += h.shape.edge + h.shape.area();
  else sum += h.shape.radius + h.shape.area();
  if (typeof h.value === "number") sum += h.value * 2;
  else sum += h.value.length;
  if (typeof h.count === "number") sum += h.count;
  else sum += Number(h.count * 2n);
  if (h.next !== null) sum += h.next.shape.sides;
  if (h.next?.next) sum += h.next.next.shape.sides;
  sum += h.mode === "on" ? 1 : 2;
  sum += typeof h.work === "function" ? h.work() : h.work.edge;
  sum += h.point.length === 2 ? h.point[1] : h.point[0];
  if ("edge" in h.shape) sum += h.shape.edge;
  switch (true) {
    case h.shape instanceof Circle:
      sum += h.shape.radius;
      break;
    default:
      sum += h.shape.edge;
  }
  return sum;
}

function make(i: number): Holder {
  const h = new Holder();
  if (i % 2 === 1) h.shape = new Circle();
  if (i % 3 === 1) h.value = "text";
  if (i % 5 === 1) h.count = 7n;
  if (i % 7 === 1) h.next = make(i + 1);
  if (i % 11 === 1) h.mode = "off";
  if (i % 13 === 1) h.work = new Square();
  if (i % 17 === 1) h.point = [9];
  return h;
}

let sum = 0;
for (let i = 0; i < 4000; i++) sum += total(make(i));
console.log("the total of 4000 holders: " + sum);
for (let i = 0; i < 20; i++) attempt("holder " + i, () => total(make(i)));
attempt("squares only", () => {
  const shapes: (Square | Circle)[] = [];
  for (let i = 0; i < 10; i++) shapes.push(i % 2 === 0 ? new Square() : new Circle());
  const squares = shapes.filter(s => s instanceof Square);
  return squares.reduce((a, s) => a + s.edge, 0);
});
