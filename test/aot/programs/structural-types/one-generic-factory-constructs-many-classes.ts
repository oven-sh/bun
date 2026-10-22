function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Small {
  a: number = 1;
}
class Large {
  a: string = "one";
  b: number = 2;
  c: number[] = [3];
  d: Small = new Small();
}
class Counting {
  static made: number = 0;
  id: number = ++Counting.made;
}
class Private {
  #secret: number = 5;
  reveal(): number {
    return this.#secret;
  }
}
abstract class Shape {
  abstract area(): number;
  describe(): string {
    return this.constructor.name + " " + this.area();
  }
}
class Square extends Shape {
  side: number = 2;
  area(): number {
    return this.side * this.side;
  }
}
class Circle extends Shape {
  radius: number = 1;
  area(): number {
    return 3 * this.radius;
  }
}

function build<T>(C: new () => T): T {
  return new C();
}
function buildMany<T>(C: new () => T, count: number): T[] {
  const list: T[] = [];
  for (let i = 0; i < count; i++) list.push(new C());
  return list;
}
function nameOf(C: abstract new () => Shape): string {
  return C.name + " " + C.length + " " + typeof C.prototype.describe;
}
function buildWith<A extends unknown[], T>(C: new (...args: A) => T, ...args: A): T {
  return new C(...args);
}

show("small", () => build(Small));
show("large", () => build(Large));
show("large b + 1", () => build(Large).b + 1);
show("small a + 1", () => build(Small).a + 1);
show("large a + 1", () => build(Large).a + 1);
show("counting", () => build(Counting).id);
show("counting again", () => build(Counting).id);
show("private", () => build(Private).reveal());
show("square", () => build(Square).describe());
show("circle", () => build(Circle).describe());
show("Date is a date", () => build(Date) instanceof Date);
show("Map", () => build(Map).size);
show("Array", () => build(Array).length);
show("Object", () => Object.keys(build(Object)).length);
show("Error", () => build(Error).message);
show("a set of numbers", () => build(Set<number>).add(1).size);
show("an anonymous class", () => build(class { z = 26; }).z);
show("abstract name", () => nameOf(Shape));
show("concrete name", () => nameOf(Square));
show("many", () => buildMany(Counting, 3).map(c => c.id).join());
show("with arguments: Map", () => buildWith(Map<string, number>, [["a", 1]]).get("a"));
show("with arguments: Array", () => buildWith(Array<number>, 3).length);
show("with arguments: Date", () => buildWith(Date, 0).getTime());

const shapes: (new () => Shape)[] = [Square, Circle, Square];
show("from an array of classes", () => shapes.map(C => new C().describe()).join());

let sum = 0;
for (let i = 0; i < 2000; i++) sum += build(Small).a;
show("2000 small ones", () => sum);
show("then a large one", () => build(Large).a);
show("then a small one", () => build(Small).a);
