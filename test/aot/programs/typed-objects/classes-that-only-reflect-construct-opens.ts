// Reflect.construct() with another new.target, of classes that nothing else in the program hands an object their constructors have not made.
const attempt = (run: () => unknown): string => { try { return String(run()); } catch (error) { return "throws " + (error as Error).name + ": " + (error as Error).message.slice(0, 60); } };
class Shape { sides: number; label = "shape"; constructor(sides: number) { this.sides = sides; this.note(); } note(): void { this.label += " of " + this.sides; } hi(): string { return "Shape.hi " + this.label; } }
class Square extends Shape { edge = 2; constructor() { super(4); } area(): number { return this.edge * this.edge; } override hi(): string { return "Square.hi " + this.area(); } }
class Target { note(): void {} hi(): string { return "Target.hi"; } }
class Untouched { n = 1; twice(): number { return this.n * 2; } }
const tell = (made: any, target: any): string => [Object.getPrototypeOf(made) === target.prototype, made.hi(), made.constructor.name, JSON.stringify(made), Object.keys(made).join()].join(" ");
console.log("the class:", attempt(() => tell(Reflect.construct(Shape, [3], Target), Target)));
console.log("the class that extends it:", attempt(() => tell(Reflect.construct(Square, [], Target), Target)));
console.log("for the class it extends:", attempt(() => tell(Reflect.construct(Square, [], Shape), Shape)));
console.log("for the class that extends it:", attempt(() => tell(Reflect.construct(Shape, [5], Square), Square)));
console.log("arguments that are spread:", attempt(() => { const all: [typeof Shape, [number], typeof Target] = [Shape, [6], Target]; return tell(Reflect.construct(...all), Target); }));
function total(list: Shape[]): number { let sides = 0; for (const each of list) sides += each.sides; return sides; }
const list: Shape[] = [new Shape(3), new Square(), new Shape(5)];
console.log(total(list), list.map(each => each.hi()).join(), new Square().area(), new Untouched().twice());
