function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class Other {
  first = "f";
}

const cache = new Map<new () => object, new () => { tag: string }>();

function Tagged(Base: new () => object): new () => { tag: string } {
  let Made = cache.get(Base);
  if (Made === undefined) {
    Made = class extends Base {
      tag = "tag over " + Base.name;
    };
    cache.set(Base, Made);
  }
  return Made;
}

console.log(describe(new (Tagged(Point))()));
console.log(describe(new (Tagged(Other))()));
console.log(describe(new (Tagged(Point))()));
console.log("one class per base: " + (Tagged(Point) === Tagged(Point)) + " " + (Tagged(Point) === Tagged(Other)) + " " + cache.size);
