// One method of a class is replaced somewhere in the program, and the prototype stays an ordinary object whose every method can be replaced. `Object.assign(Object.create(Object.getPrototypeOf(x)), x)` still keeps the layout of x: what counts is whether an accessor or a read-only property stands under a name that is copied.
// CALLS+ Labeled.copy TryCloneWithPrototype
// CALLS+ Shape.copy TryCloneWithPrototype
// CALLS+ Watched.copy TryCloneWithPrototype
class Labeled {
  id: number;
  label: string;
  constructor(id: number, label: string) {
    this.id = id;
    this.label = label;
  }
  copy(): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }
  describe(): string { return `${this.label}#${this.id}`; }
  weight(): number { return this.id * 2; }
}
abstract class Shape {
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  copy(): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }
  abstract area(): number;
  toString(): string { return `${this.kind} of ${this.area()}`; }
}
class Square extends Shape {
  declare readonly side: number;
  constructor(side: number) {
    super("square");
    this.side = side;
  }
  area(): number { return this.side * this.side; }
  override toString(): string { return `Square(${this.side})`; }
}
const seen: string[] = [];
class Watched {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  copy(): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }
  get mark(): number { return -1; }
  set mark(value: number) { seen.push(`set mark ${value} on ${this.id}`); }
  note(): string { return "note"; }
}
function show(value: any): string {
  const names = Reflect.ownKeys(value).map((key) => `${String(key)}=${String(value[key])}`);
  return `${Object.getPrototypeOf(value).constructor.name} {${names.join()}} ${Object.isFrozen(value)} ${Object.isExtensible(value)}`;
}

const first = new Labeled(1, "one");
console.log(show(first.copy()), first.copy().describe(), first.copy().weight(), first.copy() instanceof Labeled, first.copy() !== first);
Labeled.prototype.describe = function (this: Labeled): string { return `replaced ${this.label}`; };
const second = first.copy();
console.log(show(second), second.describe(), first.describe(), second.weight());
second.label = "two";
console.log(first.label, second.label, show(second.copy().copy()));

(second as any).remark = "an extra property";
(second as any)[Symbol.for("kernel")] = 4;
const third = second.copy();
console.log(show(third), third.describe(), show(third.copy()), (third as any).remark === (second as any).remark);
(third as any).remark = "changed";
console.log((second as any).remark, (third as any).remark);

const square = new Square(3);
console.log(show(square.copy()), String(square.copy()), square.copy().area(), square.copy() instanceof Shape);
Shape.prototype.toString = function (this: Shape): string { return `shape ${this.kind}`; };
Square.prototype.toString = function (this: Square): string { return `square ${this.side}`; };
console.log(show(square.copy()), String(square.copy()), Shape.prototype.toString.call(square.copy()));

const watched = new Watched(7);
Watched.prototype.note = function (): string { return "another note"; };
console.log(show(watched.copy()), watched.copy().note(), watched.copy().mark, seen.join());
Object.defineProperty(watched, "mark", { value: 5, enumerable: true, writable: true, configurable: true });
const copied = watched.copy();
console.log(show(watched), show(copied), copied.mark, seen.join());
(watched as any).extra = "kept";
console.log(show(watched.copy()), seen.join());

let total = 0;
const many: (Labeled | Square | Watched)[] = [];
for (let i = 0; i < 300; i++) many.push(i % 3 === 0 ? new Labeled(i, `l${i}`) : i % 3 === 1 ? new Square(i) : new Watched(i));
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < many.length; i++) {
    const copy = many[i]!.copy();
    many[i] = copy;
    total += copy instanceof Labeled ? copy.weight() + copy.describe().length : copy instanceof Square ? copy.area() : copy.id + copy.mark;
  }
}
console.log(total, show(many[0]), show(many[1]), show(many[2]), seen.length);
