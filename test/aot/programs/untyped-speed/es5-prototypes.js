// ES5 constructors with methods on their prototypes: an `inherits` function, one call site that sees objects of three constructors, and short-lived points allocated in the loop.
function Shape(name) {
  this.name = name;
  this.visits = 0;
}
Shape.prototype.area = function () {
  return 0;
};
Shape.prototype.describe = function () {
  this.visits++;
  return this.name.length + this.area();
};

function inherits(child, parent) {
  child.prototype = Object.create(parent.prototype);
  child.prototype.constructor = child;
}

function Rectangle(width, height) {
  Shape.call(this, "rectangle");
  this.width = width;
  this.height = height;
}
inherits(Rectangle, Shape);
Rectangle.prototype.area = function () {
  return this.width * this.height;
};

function Circle(radius) {
  Shape.call(this, "circle");
  this.radius = radius;
}
inherits(Circle, Shape);
Circle.prototype.area = function () {
  return 3 * this.radius * this.radius;
};

function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.plus = function (other) {
  return new Point(this.x + other.x, this.y + other.y);
};
Point.prototype.dot = function (other) {
  return this.x * other.x + this.y * other.y;
};

function run(count) {
  var shapes = [new Rectangle(2, 3), new Circle(4), new Rectangle(5, 6), new Shape("none")];
  var total = 0;
  var position = new Point(0, 0);
  for (var i = 0; i < count; i++) {
    var step = new Point(i & 7, i % 5);
    position = position.plus(step);
    total += (position.dot(step) % 11) + shapes[i & 3].describe();
  }
  return total + shapes[1].visits + (shapes[0] instanceof Shape ? 1 : 0);
}

console.log(run(4000000));
