class Point {
  x = 1;
}
function Secret(Base: new () => object) {
  return class extends Base {
    #hidden = 5;
    constructor() {
      super();
    }
    reveal(): number {
      return this.#hidden;
    }
  };
}
const A = Secret(Point);
const B = Secret(Point);
console.log("zq a " + new A().reveal());
console.log("zq b " + new B().reveal());
