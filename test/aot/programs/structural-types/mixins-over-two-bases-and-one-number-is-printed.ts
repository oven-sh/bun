function Tagged(Base: new () => object) {
  return class extends Base {
    tag = 5;
  };
}
function Greeting(Base: new () => object) {
  return class extends Base {
    hello(): number {
      return 3;
    }
  };
}
class Point {
  x = 1;
}
class Other {
  first = 10;
  second = 20;
}
let sum = 0;
function note(made: any): void {
  sum = (sum * 7 + Object.keys(made).length * 100 + (made.tag ?? 0) + (made.x ?? 0) + (made.first ?? 0) + (made.second ?? 0) + (made instanceof Point ? 1000 : 0)) % 1000003;
}
note(new (Tagged(Point))());
note(new (Tagged(Other))());
note(new (Greeting(Point))());
note(new (Greeting(Other))());
note(new (Tagged(Greeting(Point)))());
note(new Point());
note(new Other());
console.log(sum);
