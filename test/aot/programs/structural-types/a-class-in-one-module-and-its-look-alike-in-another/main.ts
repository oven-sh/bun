import { Shape, describe, grow, warm } from "./shape.ts";
import { Shape as Other, literal } from "./look-alike.ts";

console.log("both are called Shape: " + Shape.name + " " + Other.name + " " + (Object.is(Shape, Other)));
console.log("look-alike before any honest use: " + describe(new Other()));
console.log("honest uses in the class's own module: " + warm());
console.log("the real one: " + describe(new Shape()));
console.log("the look-alike: " + describe(new Other()));
console.log("a literal: " + describe(literal));
console.log("the real one again: " + describe(new Shape()));

const other = new Other();
console.log("the look-alike grows: " + grow(other) + " " + JSON.stringify(other));
const real = new Shape();
console.log("the real one grows: " + grow(real) + " " + JSON.stringify(real));

const local: Shape = new Other();
console.log("local: " + local.area() + " " + local.summary + " " + (local instanceof Shape) + " " + (local instanceof Other));

const Alias: typeof Shape = Other;
console.log("the static side: " + Alias.is(new Shape()) + " " + Shape.is(new Alias()) + " " + new Alias().area());

const list: Shape[] = [new Shape(), new Other(), literal, new Alias()];
console.log("elements: " + list.map(s => s.area()).join() + " " + list.map(s => s instanceof Shape).join());
console.log("json: " + JSON.stringify(list));

class Canvas {
  shapes: Shape[] = [];
  top: Shape = new Shape();
  add(s: Shape): this {
    this.shapes.push(s);
    this.top = s;
    return this;
  }
  total(): number {
    return this.shapes.reduce((sum, s) => sum + s.area(), this.top.area());
  }
}
console.log("fields: " + new Canvas().add(new Shape()).add(new Other()).add(literal).total());

class Sub extends Other {
  area(): number {
    return super.area() - 1;
  }
}
const sub: Shape = new Sub();
console.log("a subclass of the look-alike: " + describe(sub));
