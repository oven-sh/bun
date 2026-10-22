interface Shape {
  name: string;
  sides: number;
  area(): number;
}

const log: string[] = [];

class Square implements Shape {
  name = "square";
  sides = 4;
  constructor(private edge: number) {}
  area(): number {
    return this.edge * this.edge;
  }
}

class Triangle {
  sides = 3;
  base = 4;
  height = 5;
  name = "triangle";
  area(): number {
    return (this.base * this.height) / 2;
  }
}

class Circle {
  get name(): string {
    log.push("get name");
    return "circle";
  }
  set name(value: string) {
    log.push("set name " + value);
  }
  get sides(): number {
    log.push("get sides");
    return 0;
  }
  set sides(value: number) {
    log.push("set sides " + value);
  }
  area = (): number => 3;
}

class Fixed {
  static shared = 0;
  name = "fixed";
  sides = 1;
  area(): number {
    return ++Fixed.shared;
  }
}

const literal: Shape = { area: () => 7, sides: 2, name: "literal" };
const created: Shape = Object.create({ name: "created", sides: 9, area: () => 8 });

function summary(s: Shape): string {
  return s.name + " " + s.sides + " " + s.area();
}

function listing(s: Shape): string {
  const inherited: string[] = [];
  for (const key in s) inherited.push(key);
  return Object.keys(s).join() + " | " + inherited.join() + " | " + JSON.stringify(s) + " | " + Object.keys({ ...s }).join();
}

function rename(s: Shape, name: string): string {
  s.name = name;
  s.sides += 1;
  return s.name + " " + s.sides;
}

function shapes(): Shape[] {
  return [new Square(2), new Triangle(), new Circle(), new Fixed(), literal, created];
}

for (const s of shapes()) {
  console.log("summary: " + summary(s));
  console.log("listing: " + listing(s));
  console.log("own name, own area: " + Object.hasOwn(s, "name") + " " + Object.hasOwn(s, "area"));
  console.log("log: " + log.join());
  log.length = 0;
}

for (const s of shapes()) {
  console.log("renamed: " + rename(s, "renamed"));
  console.log("log: " + log.join());
  log.length = 0;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += new Square(i % 3).area();
console.log("2000 squares: " + total);
const areaOf = (s: Shape) => s.area();
for (let i = 0; i < 2000; i++) areaOf(new Square(1));
console.log("then the rest at one site: " + shapes().map(areaOf).join());

class Drawing {
  shapes: Shape[] = [];
  main: Shape = new Square(1);
  add(s: Shape): this {
    this.shapes.push(s);
    this.main = s;
    return this;
  }
  total(): number {
    let sum = 0;
    for (const s of this.shapes) sum += s.area() + s.sides;
    return sum;
  }
}

const drawing = new Drawing();
for (const s of shapes()) console.log("main is now: " + drawing.add(s).main.name);
console.log("total: " + drawing.total());

export {};
