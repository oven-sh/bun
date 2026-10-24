// Nothing constructs these classes or names them in an expression. They are used as types: of an object literal, of a parameter, after implements, as the base of an interface, through InstanceType and through an indexed access. The types of their members come from initializers and bodies.
class Point {
  x = 1;
  y = 2;
  label = "point";
  norm() {
    return Math.hypot(this.x, this.y);
  }
  get doubled() {
    return { x: this.x * 2, y: this.y * 2 };
  }
  static origin() {
    return new Point();
  }
}
class Named {
  name = "";
  greet() {
    return "hello " + this.name;
  }
}

const literal: Point = { x: 3, y: 4, label: "literal", norm() { return 5; }, doubled: { x: 6, y: 8 } };
function describe(point: Point) {
  return point.label + " " + point.norm().toFixed(1) + " " + point.doubled.x;
}
class Person implements Named {
  name = "Ada";
  greet() {
    return "hi " + this.name;
  }
}
interface Labeled extends Named {
  tag: string;
}
const labeled: Labeled = { name: "Bo", tag: "t", greet: () => "hey" };
const instance: InstanceType<typeof Point> = literal;
const norm: Point["norm"] = () => 9;
const made: ReturnType<typeof Point.origin> = literal;

console.log(describe(literal), new Person().greet(), labeled.greet(), labeled.tag, instance.y, norm() + 1, made.x);
