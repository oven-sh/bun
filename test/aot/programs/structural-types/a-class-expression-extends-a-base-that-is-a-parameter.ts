function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
  };
}

class Point {
  x = 1;
}

const made = new (Tagged(Point))();
console.log(Object.keys(made).join());
console.log(JSON.stringify(made), made.tag, made instanceof Point);
