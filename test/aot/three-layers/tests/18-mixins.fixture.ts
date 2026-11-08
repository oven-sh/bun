import { check } from "../src/show";
import { Serializable, Countable, Shape, Circle } from "fake-shapes";
import { Vec2, Dog } from "fake-typed";
import { Square, SerialSquare, CountedSquare, Both } from "../src/models";
const F = "18";
type Ctor<T = {}> = new (...args: any[]) => T;
const Tagged = <B extends Ctor>(Base: B) => class Tagged extends Base { tag = "tagged"; static kindOf = "Tagged(" + Base.name + ")"; describeTag() { return this.tag + ":" + (this as any).constructor.name; } };
const Loud = <B extends Ctor<{ describe(): string }>>(Base: B) => class extends Base { override describe() { return super.describe().toUpperCase(); } };
class Final extends Loud(Countable(Tagged(Serializable(Square)))) { extra = [1]; arrow = () => this.extra; static { (this as any).ready = true; } }
check(F, "a tower over three layers", () => { const f = new Final("f", 2), g = new Final("g", 3); return [f.describe(), g.describe(), f.serialize(), f.describeTag(), f.ordinal, g.ordinal, Final.made, (Final as any).ready, (Final as any).kindOf, Final.label(), f.arrow() === f.extra, f.area(), f.doubled(), f instanceof Square, Shape.isShape(f), Object.keys(f)]; });
check(F, "each application is a new class", () => [Serializable(Square) === Serializable(Square), new (Serializable(Square))("a", 1) instanceof SerialSquare, new SerialSquare("a", 1) instanceof Square, CountedSquare.made, new CountedSquare("c", 1).ordinal, new CountedSquare("d", 1).describe(), CountedSquare.made, Both.name, SerialSquare.name, CountedSquare.name]);
check(F, "mixins over typed classes", () => { const TV = Tagged(Vec2), TD = Tagged(Dog); const v = new TV(1, 2), d = new TD("rex"); return [v.parts(), v.tag, v.describeTag(), v.add(new Vec2(1, 1)).constructor.name, String(v), d.speak(), d.tricks, d.tag, TV.kindOf, TV.zero === Vec2.zero, Object.keys(v), Object.keys(d)]; });
check(F, "super in object literals and static methods", () => { const base = { hi() { return "base"; } }; const o = { __proto__: base, hi() { return "o>" + super.hi(); } }; class S extends Circle { static override create(...args: any[]): any { return ["S", (super.create as any)(...args).describe()]; } } return [o.hi(), S.create("c", 1), (Circle.create as any).call(Square, "viaCall", 2).describe()]; });
check(F, "class expressions and names", () => { const A = class extends Shape {}; const holder = { C: class extends Square {} }; const B = holder.C; const made = [new A("a"), new B("b", 1)]; return [A.name, B.name, made.map(m => m.describe()), (class extends Shape { static override name = "Renamed"; }).name]; });
check(F, "accessors and fields shadow each other", () => { class Odd extends Circle { override r = 5; } class Getter extends Square {} Object.defineProperty(Getter.prototype, "side", { get() { return 10; }, set(_v: number) {}, configurable: true }); let g: unknown; try { g = new Getter("g", 1).area(); } catch (e) { g = (e as Error).name; } return [new Odd("o", 1).r, new Odd("o", 1).area(), g]; });
