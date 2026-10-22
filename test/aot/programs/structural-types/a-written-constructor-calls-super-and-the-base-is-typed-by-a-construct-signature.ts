class Point {
  x = 1;
}
const Base: new () => object = Point;
class Derived extends Base {
  constructor() {
    super();
  }
}
const made = new Derived();
console.log("zq keys [" + Object.keys(made).join(" ") + "] point " + (made instanceof Point));
