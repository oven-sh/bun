class Circle {
  radius = 2;
  label = "circle";
  area(): number {
    return this.radius * this.radius * 3;
  }
  title(): string {
    return this.label.toUpperCase();
  }
}

class Square {
  label = "square";
  side = 5;
  area(): number {
    return this.side * this.side;
  }
  title(): string {
    return this.label + " of " + this.side;
  }
}

class Nothing {
  area(): number {
    return 0;
  }
  title(): string {
    return "nothing";
  }
}

function text(n: number): string {
  return typeof n + " " + (Object.is(n, -0) ? "-0" : String(n));
}

function areaOf(c: Circle): string {
  return text(c.area());
}

function squareArea(s: Square): string {
  return text(s.area());
}

function round(label: string, c: Circle, s: Square): void {
  console.log(label + ": circle " + text(c.area()) + " | " + areaOf(c) + " | " + c.title() + "; square " + text(s.area()) + " | " + squareArea(s) + " | " + s.title());
}

const c = new Circle();
const s = new Square();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += c.area() + s.area() + areaOf(c).length + squareArea(s).length;
console.log("2000 honest: " + warm);
round("before", c, s);

c.area = s.area;
c.title = s.title;
round("the circle borrows from the square", c, s);

c.area = Nothing.prototype.area;
c.title = Nothing.prototype.title;
round("the circle borrows from a class without fields", c, s);

Reflect.deleteProperty(c, "area");
Reflect.deleteProperty(c, "title");
round("uncovered", c, s);

[Circle.prototype.area, Square.prototype.area] = [Square.prototype.area, Circle.prototype.area];
[Circle.prototype.title, Square.prototype.title] = [Square.prototype.title, Circle.prototype.title];
round("the two classes swap their methods", c, s);
round("new instances", new Circle(), new Square());

[Circle.prototype.area, Square.prototype.area] = [Square.prototype.area, Circle.prototype.area];
[Circle.prototype.title, Square.prototype.title] = [Square.prototype.title, Circle.prototype.title];
round("swapped back", c, s);

export {};
