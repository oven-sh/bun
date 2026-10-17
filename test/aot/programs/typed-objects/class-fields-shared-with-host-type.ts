// A class without methods whose fields a type of the host also has (`x` and `y`: DOMPoint; `width` and `height`: an image) is laid out and read like any other class: nobody hands a constructor its `this`, so nothing but what `new` makes is ever held to the class by its declaration alone.
// IR- ^shape \d+ Instance "(Point|Size|Named)" .* accepts-untyped
// IR= 1 twice GetById v[0-9]+ "x"
// IR= 1 area GetById v[0-9]+ "width"
// IR+ ^shape \d+ Instance "Opened" .* accepts-untyped
class Point { constructor(public x: number, public y: number) {} }
class Size { width = 2; height = 3 }
class Named { name = "n"; message = "m" }
class Opened { left = 1; top = 2 }
class Probed { constructor(public x: number, public y: number) {} }
class Other { width = 2; height = 3 }
let failures = 0;
function twice(p: Point): number { try { return p.x * 3 + p.y + p.x; } catch { failures++; return 0; } }
function area(s: Size): number { try { return s.width * s.height + s.width; } catch { failures++; return 0; } }
function label(n: Named): string { return n.name + ":" + n.message; }
function sum(o: Opened): number { return o.left + o.top; }
const hide = (value: unknown): any => value;
let reads = 0;
const counting = { get left() { reads++; return 10; }, top: 20 };
let total = 0;
function run(point: Point, size: Size): void { for (let i = 0; i < 1000; i++) total += twice(point) + area(size); }
run(new Point(5, 1), new Size());
total += twice(new Point(7, 1)) + area(new Size());
console.log(total, failures, label(new Named()), sum(new Opened()), sum(hide(counting)), reads);
console.log(Object.keys(new Probed(1, 2)).join(), JSON.stringify(new Other()), new Probed(1, 2) instanceof Probed, Reflect.construct(Probed, [4, 5]).y);
try { (Probed as any)(1, 2); } catch (e) { console.log((e as Error).constructor === TypeError); }
try { (Probed as any).call({ x: 0, y: 0 }, 1, 2); } catch (e) { console.log((e as Error).constructor === TypeError); }
export {};
