const tag: unique symbol = Symbol("tag");

class Shape {
  side = 2;
  area(): number {
    return this.side * this.side;
  }
  get double(): number {
    return this.side * 2;
  }
  set double(value: number) {
    this.side = value / 2;
  }
  get only(): string {
    return "only a getter";
  }
  [tag](): string {
    return "tagged";
  }
  3(): string {
    return "three";
  }
  last(): string {
    return "last";
  }
  static count = 0;
  static make(): Shape {
    return new Shape();
  }
  static get kind(): string {
    return "shape";
  }
}

class Box extends Shape {
  area(): number {
    return super.area() * 6;
  }
  depth(): number {
    return 1;
  }
}

function describe(holder: object): string {
  return Reflect.ownKeys(holder)
    .map(key => {
      const d = Object.getOwnPropertyDescriptor(holder, key);
      if (!d) return String(key) + " nothing";
      const flags = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
      const kind = "value" in d ? typeof d.value : (d.get ? "get" : "") + (d.set ? "set" : "");
      return String(key) + " " + kind + " " + flags;
    })
    .join(", ");
}

function listings(label: string, holder: object): void {
  console.log(label + ", own keys: " + describe(holder));
  const inherited: string[] = [];
  for (const key in holder) inherited.push(key);
  console.log(label + ", names " + Object.getOwnPropertyNames(holder).join() + " | keys " + Object.keys(holder).join() + " | for-in " + inherited.join() + " | spread " + Object.keys({ ...holder }).join() + " | json " + JSON.stringify(holder));
}

listings("the prototype, untouched", Shape.prototype);
listings("the class, untouched", Shape);
listings("the subclass's prototype, untouched", Box.prototype);
listings("the subclass, untouched", Box);
console.log("questions: " + ["area", "double", "side", "constructor", "toString"].map(name => name + " " + (name in Shape.prototype) + " " + Object.hasOwn(Shape.prototype, name)).join(", "));

const s = new Shape();
console.log("used: " + s.area() + " " + s.double + " " + s.only + " " + s[tag]() + " " + s[3]() + " " + s.last() + " " + Shape.make().side + " " + Shape.kind + " " + new Box().area());
listings("the prototype, after use", Shape.prototype);

const area = Shape.prototype.area;
Shape.prototype.area = () => -1;
listings("area replaced", Shape.prototype);

Reflect.deleteProperty(Shape.prototype, "area");
listings("area deleted", Shape.prototype);

Shape.prototype.area = area;
listings("area stored again", Shape.prototype);

Object.defineProperty(Shape.prototype, "double", { value: 9, writable: true, enumerable: true, configurable: true });
listings("the pair redefined as a value that is listed", Shape.prototype);

Shape.make = () => new Box();
Reflect.deleteProperty(Shape, "count");
listings("the class, make replaced and count deleted", Shape);

Box.prototype.last = () => "the box's last";
listings("the subclass's prototype, a member added", Box.prototype);

Object.freeze(Box.prototype);
listings("the subclass's prototype, frozen", Box.prototype);
console.log("frozen: " + Object.isFrozen(Box.prototype) + " " + Object.isFrozen(Shape.prototype) + " " + Object.isExtensible(Box.prototype));
console.log("still works: " + new Box().area() + " " + new Box().last() + " " + new Box().depth());

export {};
