function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function tagged<T extends new (...args: any[]) => object>(target: T, context: ClassDecoratorContext<T>) {
  return class extends target {
    tag = "added by the decorator for " + String(context.name);
  };
}

@tagged
class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

const made = new Point();
console.log(describe(made));
console.log("members: " + made.x + " " + made.y + " " + made.sum());
console.log("instance: " + (made instanceof Point));
class Child extends Point {
  z = 3;
}
console.log("a subclass of the decorated class: " + describe(new Child()) + " " + new Child().sum());
