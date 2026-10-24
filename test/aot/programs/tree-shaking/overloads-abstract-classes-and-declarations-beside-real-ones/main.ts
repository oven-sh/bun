// What TypeScript lets stand beside a body: overload signatures, abstract members, `declare` fields, an interface and a type of the same name as a function, a `declare function` for a global that another file creates.
import "./global";

function format(value: number): string;
function format(value: string): string;
function format(value: number | string): string { return "formatted " + inner(value); }
function inner(value: number | string) { return typeof value + " " + value; }

abstract class Shape {
  abstract area(): number;
  describe(): string { return this.constructor.name + " of " + round(this.area()); }
}
function round(n: number) { return n.toFixed(1); }
class Circle extends Shape {
  declare tag: string;
  area() { return Math.PI; }
}

interface Maker { (): string }
function Maker() { return "the function Maker"; }
type Both = string;
const Both = () => "the constant Both";

declare function providedElsewhere(): string;

class Overloaded {
  method(a: number): string;
  method(a: string): string;
  method(a: unknown) { return "overloaded method " + a; }
  constructor();
  constructor(a: number);
  constructor(public a?: number) {}
}

console.log(format(1), format("a"));
console.log(new Circle().describe(), "tag" in new Circle());
const maker: Maker = Maker;
const both: Both = Both();
console.log(maker(), both);
console.log(providedElsewhere());
console.log(new Overloaded(1).method(2), new Overloaded().a);
