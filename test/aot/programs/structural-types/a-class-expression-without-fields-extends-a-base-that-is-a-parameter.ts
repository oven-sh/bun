function Greeting(Base: new () => object) {
  return class extends Base {
    hello(): string {
      return "hello";
    }
  };
}

class Point {
  x = 1;
}

class Other {
  first = 1;
}

console.log(Object.keys(new (Greeting(Point))()).join());
console.log(Object.keys(new (Greeting(Other))()).join());
