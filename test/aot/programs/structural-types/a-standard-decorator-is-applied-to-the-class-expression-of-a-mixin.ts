function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const registered: string[] = [];

function registered_as(label: string) {
  return function <T extends new (...args: any[]) => object>(target: T, context: ClassDecoratorContext<T>) {
    registered.push(label + " over " + Object.getPrototypeOf(target).name);
    return class extends target {
      stamped = label;
    };
  };
}

class Point {
  x = 1;
}

class Name {
  first = "f";
}

function Tagged(Base: new () => object) {
  return @registered_as("tagged") class extends Base {
    tag = "tag";
  };
}

console.log(describe(new (Tagged(Point))()));
console.log(describe(new (Tagged(Name))()));
console.log(describe(new (Tagged(Tagged(Point)))()));
console.log(registered.join(", "));
