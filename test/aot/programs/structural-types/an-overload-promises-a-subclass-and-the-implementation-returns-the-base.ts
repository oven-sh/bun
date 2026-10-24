class Shape {
  sides = 4;
}
class Square extends Shape {
  edge = 2;
}
function make(kind: "square"): Square;
function make(kind: "shape"): Shape;
function make(kind: string): Shape {
  return new Shape();
}
console.log(make("square").edge * 2);
