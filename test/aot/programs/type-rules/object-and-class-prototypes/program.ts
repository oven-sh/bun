class Animal {
  legs = 4
  speak(): string { return "animal" + this.legs }
  move(): string { return "walk" }
  get kindName(): string { return "A" + this.legs }
  static create(): Animal { return new this() }
}
class Dog extends Animal {
  tricks = 0
  override speak(): string { return "dog>" + super.speak() }
  fetch(): string { return "fetch" + ++this.tricks }
  override get kindName(): string { return "D" + super.kindName }
}
class Robot {
  legs = 2
  volts = 5.5
  speak(): string { return "robot" + this.legs }
  move(): string { return "roll" }
  beep(): string { return "beep" + this.legs }
  get kindName(): string { return "R" + this.legs }
  static create(): Robot { return new Robot() }
}
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function use(a: Animal): string { return [a.speak(), a.move(), a.kindName, a.legs, a instanceof Animal, a instanceof Dog, Object.keys(a).join("+")].join() }
const rex = new Dog(), cow = new Animal()
function all(label: string) { console.log(label, "|", use(rex), "|", use(cow), "|", use(new Dog()), "|", rex instanceof Robot, "beep" in rex, Dog.create() instanceof Dog) }
try { all("start") } catch (e) { console.log("line 31:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an object, the prototype of another class", () => { Object.setPrototypeOf(rex, Robot.prototype) }) } catch (e) { console.log("line 32:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an object, the prototype of the class that is extended, by __proto__", () => { (rex as any).__proto__ = Animal.prototype }) } catch (e) { console.log("line 33:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an object, null", () => { Object.setPrototypeOf(cow, null) }) } catch (e) { console.log("line 34:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an object, a literal", () => { Object.setPrototypeOf(cow, { legs: 100, move: () => "slide" }) }) } catch (e) { console.log("line 35:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an object, a proxy", () => { Object.setPrototypeOf(cow, new Proxy(Animal.prototype, {})) }) } catch (e) { console.log("line 36:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("by Reflect:", Reflect.setPrototypeOf(rex, Robot.prototype), Reflect.setPrototypeOf(cow, null)) } catch (e) { console.log("line 37:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { all("the objects") } catch (e) { console.log("line 38:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("the prototype of a class, that of another class", () => { Object.setPrototypeOf(Dog.prototype, Robot.prototype) }) } catch (e) { console.log("line 39:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("the prototype of a class, null", () => { Object.setPrototypeOf(Dog.prototype, null) }) } catch (e) { console.log("line 40:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("the prototype of a class, a literal", () => { Object.setPrototypeOf(Dog.prototype, { speak(this: Dog) { return "literal" + this.tricks } }) }) } catch (e) { console.log("line 41:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("by Reflect:", Reflect.setPrototypeOf(Dog.prototype, Robot.prototype)) } catch (e) { console.log("line 42:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { all("the prototypes") } catch (e) { console.log("line 43:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("the class, another class", () => { Object.setPrototypeOf(Dog, Robot) }) } catch (e) { console.log("line 44:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("by Reflect:", Reflect.setPrototypeOf(Dog, Robot), Object.getPrototypeOf(Dog) === Animal) } catch (e) { console.log("line 45:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { all("the class") } catch (e) { console.log("line 46:", e instanceof TypeError ? "TypeError" : "other " + e) }
// A field is deleted as in plain Bun.
try { attempt("delete of a required field", () => delete (cow as any).legs) } catch (e) { console.log("line 48:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(cow.legs, Object.keys(cow).join(), "legs" in cow) } catch (e) { console.log("line 49:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Records.
interface Rec { v: number; describe?(): string; w?: number }
const recs: Rec[] = [{ v: 1 }, { v: 2, describe() { return "own" + this.v } }, { w: 7, v: 3 }]
function tell(r: Rec): string { return (r.describe?.() ?? "silent") + "/" + r.v + "/" + r.w + "/" + ("describe" in r) + ("w" in r) + "/" + Object.keys(r).join("") }
const helper = { describe(this: Rec) { return "inherited" + this.v }, w: 0.5 }
for (const r of recs) attempt("a record, a literal", () => { Object.setPrototypeOf(r, helper) })
try { console.log(recs.map(tell).join(" ")) } catch (e) { console.log("line 56:", e instanceof TypeError ? "TypeError" : "other " + e) }
// In the middle of a loop, inside a call the loop makes.
function run(a: Animal, change: (i: number) => void): string { const out: string[] = []; for (let i = 0; i < 3; i++) { out.push(a.speak() + a.kindName); try { change(i) } catch (e) { out.push(e instanceof TypeError ? "TypeError" : "other " + e) } out.push(a.move()) } return out.join() }
try { console.log(run(rex, i => { if (i === 1) Object.setPrototypeOf(rex, Robot.prototype) })) } catch (e) { console.log("line 59:", e instanceof TypeError ? "TypeError" : "other " + e) }
