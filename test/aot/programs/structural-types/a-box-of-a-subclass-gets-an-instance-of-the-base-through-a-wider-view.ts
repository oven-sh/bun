class Shape {
  sides = 4;
}
class Square extends Shape {
  edge = 2;
}
class Box<T> {
  constructor(public value: T) {}
}
const box = new Box(new Square());
const wide: Box<Shape> = box;
wide.value = new Shape();
console.log(box.value.edge * 2);
