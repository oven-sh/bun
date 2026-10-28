interface Opts { width: number; height?: number; label?: string; unit?: string }
function show(o: Opts): string {
  return [o.width, String(o.height), String(o.label), String(o.unit), "height" in o, Object.hasOwn(o, "height"), Object.keys(o).join("")].join("/")
}
const small: Opts = { width: 2 }
try { Object.setPrototypeOf(small, { height: 5, label: "from proto" }); console.log("an ordinary object: no error") } catch (e) { console.log("an ordinary object:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.setPrototypeOf(small, { set height(h: number) {}, get height() { return 40 } }); console.log("one with accessors: no error") } catch (e) { console.log("one with accessors:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.setPrototypeOf({ width: 3 } as Opts, null); console.log("null: no error") } catch (e) { console.log("null:", e instanceof TypeError ? "TypeError" : "other " + e) }
const parentOpts: Opts = { width: 100, height: 50, unit: "cm" }
try { (small as any).__proto__ = parentOpts; console.log("__proto__ =, a compiled object: no error") } catch (e) { console.log("__proto__ =, a compiled object:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Reflect.setPrototypeOf(small, parentOpts)); console.log("Reflect.setPrototypeOf: no error") } catch (e) { console.log("Reflect.setPrototypeOf:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(small), Object.getPrototypeOf(small) === Object.prototype, String(small)) } catch (e) { console.log("line 13:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Instances of a class.
class Shape2 {
  side = 2; tint?: string
  area(): number { return this.side * this.side }
  get twice(): number { return this.side * 2 }
  describe(): string { return "shape " + this.area() + " " + this.twice + " " + String(this.tint) }
}
class Cube extends Shape2 { override area(): number { return super.area() * 6 } }
const moved = new Shape2(), cube = new Cube()
try { Object.setPrototypeOf(moved, Cube.prototype); console.log("the prototype of a subclass: no error") } catch (e) { console.log("the prototype of a subclass:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.setPrototypeOf(moved, { area() { return -1 }, describe: Shape2.prototype.describe }); console.log("an ordinary object for an instance: no error") } catch (e) { console.log("an ordinary object for an instance:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.setPrototypeOf(moved, null); console.log("null for an instance: no error") } catch (e) { console.log("null for an instance:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(moved.describe(), moved instanceof Cube, moved instanceof Shape2) } catch (e) { console.log("line 26:", e instanceof TypeError ? "TypeError" : "other " + e) }
// The chain higher up: between the two classes.
try { Object.setPrototypeOf(Cube.prototype, { area() { return 1000 } }); console.log("the prototype of the prototype of a class: no error") } catch (e) { console.log("the prototype of the prototype of a class:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Reflect.setPrototypeOf(Cube.prototype, null)); console.log("by Reflect: no error") } catch (e) { console.log("by Reflect:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.setPrototypeOf(Cube, Function.prototype); console.log("the prototype of the class object: no error") } catch (e) { console.log("the prototype of the class object:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(cube.describe(), cube instanceof Shape2) } catch (e) { console.log("line 31:", e instanceof TypeError ? "TypeError" : "other " + e) }
