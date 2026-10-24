interface Point {
  extra(): number;
}

class Point {
  x = 1;
}

function extraOf(p: Point): string {
  try {
    return "extra " + p.extra();
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

console.log("before: " + extraOf(new Point()) + " " + typeof new Point().extra);
Point.prototype.extra = function () {
  return this.x + 1;
};
console.log("after: " + extraOf(new Point()) + " " + typeof new Point().extra);

export {};
