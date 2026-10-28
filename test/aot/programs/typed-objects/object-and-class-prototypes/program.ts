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
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function use(a: Animal): string { return [attempt(() => a.speak()), attempt(() => a.move()), attempt(() => "kindName" in a ? a.kindName : "no kindName"), a.legs, a instanceof Animal, a instanceof Dog, Object.keys(a).join("+")].join() }
function useDog(d: Dog): string { return use(d) + "," + attempt(() => d.fetch()) + "," + d.tricks }
const rex = new Dog(), fido = new Dog(), cow = new Animal()
function all(label: string) { console.log(label, "|", useDog(rex), "|", useDog(fido), "|", use(cow), "|", attempt(() => useDog(new Dog()))) }
all("start")
console.log(Object.getPrototypeOf(rex) === Dog.prototype, Object.getPrototypeOf(Dog.prototype) === Animal.prototype, Object.getPrototypeOf(Animal.prototype) === Object.prototype, Object.getPrototypeOf(Dog) === Animal, Object.getPrototypeOf(Animal) === Function.prototype, (rex as any).__proto__ === Dog.prototype, (rex as any).constructor.name, rex instanceof Robot, "fetch" in rex, "beep" in rex)
console.log(Dog.create() instanceof Dog, Animal.create() instanceof Dog, Dog.create().speak(), Robot.create().speak(), "toString" in fido, attempt(() => `${fido}`), attempt(() => fido.legs + fido.tricks))

// The prototype it has.
Object.setPrototypeOf(rex, Dog.prototype); (rex as any).__proto__ = Dog.prototype; Object.setPrototypeOf(Dog.prototype, Animal.prototype); Object.setPrototypeOf(Dog, Animal)
console.log(Reflect.setPrototypeOf(cow, Animal.prototype), Reflect.setPrototypeOf(Animal.prototype, Object.prototype), Reflect.setPrototypeOf(Dog, Animal))
all("as before")

// What cannot be done.
console.log(attempt(() => Object.setPrototypeOf(Animal.prototype, rex)), Reflect.setPrototypeOf(Animal.prototype, fido), attempt(() => Object.setPrototypeOf(Object.preventExtensions(new Dog()), Robot.prototype)), Reflect.setPrototypeOf(Object.freeze(new Dog()), Dog.prototype), Reflect.setPrototypeOf(Object.freeze(new Dog()), null))

// A literal with the members of the class is an Animal as well.
const slider: Animal = { legs: 100, speak() { return "plain" + this.legs }, move: () => "slide", kindName: "value" }
console.log(use(slider), slider.legs++, slider.speak(), Object.keys(slider).join())

// Records of an interface with an optional method and an optional field.
interface Rec { v: number; describe?(): string; w?: number }
const recs: Rec[] = [{ v: 1 }, { v: 2, describe() { return "own" + this.v } }, { w: 7, v: 3 }]
function tell(r: Rec): string { return (r.describe?.() ?? "silent") + "/" + r.v + "/" + r.w + "/" + ("describe" in r) + ("w" in r) + "/" + Object.keys(r).join("") }
console.log(recs.map(tell).join(" "))
recs[0].w = 9; delete recs[2].w; delete recs[1].describe
console.log(recs.map(tell).join(" "))
for (const r of recs) Object.setPrototypeOf(r, Object.prototype)
console.log(recs.map(tell).join(" "))

function run(a: Animal, change: (i: number) => void): string { const out: string[] = []; for (let i = 0; i < 5; i++) { out.push(a.speak() + a.kindName); change(i); out.push(a.move()) } return out.join() }
console.log(run(fido, i => { if (i === 1) fido.legs = 3; if (i === 3) Object.setPrototypeOf(fido, Dog.prototype) }))
let chars = 0
const pack: Animal[] = [rex, fido, cow, new Dog(), new Animal(), slider]
for (let i = 0; i < 20000; i++) {
  const a = pack[i % pack.length]
  if (i % 997 === 0) a.legs++
  chars += a.speak().length + a.kindName.length + a.legs
}
console.log(chars, pack.map(a => (a as any).constructor.name).join())
