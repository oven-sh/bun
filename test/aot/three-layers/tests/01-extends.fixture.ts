import { check } from "../src/show";
import { Shape, Circle, callArea, callWithNew, readName } from "fake-shapes";
import { Square, Ring, Vec3, Cat, Puppy } from "../src/models";
import { Vec2, Animal, Dog, total, isVec, describeUnknown } from "fake-typed";
const F = "01";
class Cube extends Square {
  depth = 3;
  constructor(name: string) { super(name, 2); }
  override area(): number { return super.area() * 6; }
  override describe(): string { return "cube " + super.describe(); }
}
class Vec4 extends Vec3 { w = 4; override parts(): number[] { return [...super.parts(), this.w]; } }
check(F, "three levels", () => { const c = new Cube("c"); return [c.describe(), c.area(), c.doubled(), c.side, c.depth, c.kind, c.initialised, c.name, c.tags, c.id > 0]; });
check(F, "instanceof", () => { const c = new Cube("c"); return [c instanceof Cube, c instanceof Square, c instanceof Shape, c instanceof Circle, Shape.isShape(c), Shape.isShape({}), ({ pretendsToBeShape: true }) as any instanceof Shape, ({ pretendsToBeShape: true }) as any instanceof Square]; });
check(F, "static inheritance", () => [Cube.create("made").describe(), Square.unit().area(), Object.getPrototypeOf(Cube) === Square, Object.getPrototypeOf(Square) === Shape, Cube.count === Shape.count, Cube.name, Cube.length]);
check(F, "called from the package", () => [callArea(new Cube("x")), callArea(new Ring("r", 2, 1)), callWithNew(Cube, "n").describe(), readName(new Cube("named"))]);
check(F, "accessors through super", () => { const r = new Ring("r", 2, 1); const before = r.diameter; r.diameter = 1010; return [before, r.r, r.diameter]; });
check(F, "typed vectors", () => { const v = new Vec4(1, 2, 3); return [String(v), v.dims(), v.length, [...v], v.add(new Vec2(1, 1)).parts(), total([v, new Vec3(1, 1, 1), new Vec2(5, 5)]).parts(), isVec(v), describeUnknown(v), v.scale(2) === v, v.x]; });
check(F, "fields and abstract methods run in order", () => { const c = new Cat("tom"), p = new Puppy("rex"), d = new Dog("old"); return [c.heard(), c.speak(), c.lives, p.heard(), p.speak(), p.tricks, d.tricks, p.legCount, p instanceof Animal, describeUnknown(p)]; });
check(F, "prototype chain", () => { const names: string[] = []; for (let p = Object.getPrototypeOf(new Cube("c")); p; p = Object.getPrototypeOf(p)) names.push(p.constructor.name + ":" + Object.getOwnPropertyNames(p).sort().join(",")); return names.slice(0, 3); });
check(F, "new.target and Reflect.construct", () => { const made = Reflect.construct(Square, ["r", 3], Cube) as Cube; return [made instanceof Cube, made.area(), made.depth, made.side]; });
