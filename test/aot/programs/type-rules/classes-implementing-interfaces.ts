// A method taken off its class and called on an object that is not an instance of the class throws a TypeError.
class Square {
  sides = 4
  constructor(public edge: number) {}
  area() { return this.edge * this.edge }
}
class Framed extends Square {
  frame = 1
  override area() { return super.area() + this.frame }
}
const area = Square.prototype.area
try { console.log(area.call({ edge: 3 })); console.log("method of a class on a literal: no error") } catch (e) { console.log("method of a class on a literal:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Framed.prototype.area.call({ edge: 2, frame: 5 })); console.log("method of a subclass on a literal: no error") } catch (e) { console.log("method of a subclass on a literal:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Framed.prototype.area.call(new Square(2))); console.log("method of a subclass on an instance of the base: no error") } catch (e) { console.log("method of a subclass on an instance of the base:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(area.call(new Framed(4)), area.call(new Square(3)))
