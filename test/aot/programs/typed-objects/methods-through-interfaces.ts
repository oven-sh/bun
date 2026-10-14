// Method calls through an interface that is implemented by object literals with methods.
interface Speaker { id: number; speak(greeting: string): string; shout?(): string }
function sharedSpeak(this: Speaker, greeting: string): string { return greeting + " shared " + this.id }
class ClassSpeaker implements Speaker {
  constructor(public id: number) {}
  speak(greeting: string): string { return greeting + " class " + this.id }
}
class LoudSpeaker extends ClassSpeaker {
  override speak(greeting: string): string { return super.speak(greeting).toUpperCase() }
  shout(): string { return "LOUD" + this.id }
}
class FieldSpeaker implements Speaker {
  id = 6
  speak = (greeting: string): string => greeting + " field " + this.id
  shout?: () => string
}
let getterCalls = 0
class GetterSpeaker implements Speaker {
  id = 7
  get speak(): (greeting: string) => string { getterCalls++; return greeting => greeting + " getter " + this.id }
}
const literalMethod: Speaker = { id: 1, speak(greeting) { return greeting + " method " + this.id } }
const literalArrow: Speaker = { id: 2, speak: greeting => greeting + " arrow", shout: () => "arrow shout" }
const literalFunction: Speaker = { speak: function (this: Speaker, greeting: string) { return greeting + " function " + this.id }, id: 3 }
const literalShared: Speaker = { id: 8, speak: sharedSpeak, shout: undefined }
const literalBound: Speaker = { id: 9, speak: sharedSpeak.bind(literalMethod) }
const literalGetter: Speaker = { id: 10, get speak() { getterCalls++; return sharedSpeak } }
const callable: Speaker = Object.assign(function () { return 0 }, { id: 12, speak: sharedSpeak })
const speakers: Speaker[] = [literalMethod, literalArrow, literalFunction, new ClassSpeaker(4), new LoudSpeaker(5), new FieldSpeaker(), new GetterSpeaker(), literalShared, literalBound, literalGetter, callable]
function talk(s: Speaker): string { return s.speak("hi") + "|" + (s.shout?.() ?? "-") + "|" + ("shout" in s) + "|" + Object.keys(s).join("") }
console.log(speakers.map(talk).join("\n"))
console.log(getterCalls)

// The same calls by a constant key, by a key that is computed, and on the function taken out first.
const key = ["sp", "eak"].join("") as "speak"
console.log(speakers.map(s => s["speak"]("a") + "/" + s[key]("b")).join(), getterCalls)
console.log(speakers.map(s => { const f = s.speak; return f.call(s, "c") }).join(), getterCalls)

// The function is read before the arguments are evaluated, and the arguments of an absent optional method are not evaluated.
let evaluated = 0
function replacing(s: Speaker): string { return s.speak((s.speak = () => "replaced " + s.id, "old")) + " then " + s.speak("new") }
function optional(s: Speaker): string { return String(s.shout?.call(s, ...(evaluated++, [] as []))) }
console.log(replacing({ id: 20, speak: sharedSpeak }), "|", replacing(new FieldSpeaker()))
// The checker sees the stores: `speak` is a replaced method, also of the classes.
const stored = new ClassSpeaker(30)
stored.speak = literalArrow.speak
console.log(replacing(new ClassSpeaker(21)), "|", stored.speak("hi"), Object.keys(stored).join(), Object.hasOwn(stored, "speak"), new ClassSpeaker(31).speak("x"), new ClassSpeaker(4).speak.call(literalArrow, "d"))
console.log(speakers.map(optional).join(), evaluated)

// Methods are stored through the interface: from one member to another, one that the class lacks, then removed again.
const target = new ClassSpeaker(30)
const asSpeaker: Speaker = target
asSpeaker.shout = function (this: Speaker) { return "late shout " + this.id }
console.log(talk(asSpeaker), talk(target))
delete asSpeaker.shout
console.log(talk(target))
literalMethod.speak = literalArrow.speak; literalArrow.speak = sharedSpeak; literalArrow.shout = undefined
console.log(talk(literalMethod), talk(literalArrow), talk(literalBound))
try { (new GetterSpeaker() as Speaker).speak = sharedSpeak; console.log("stored") } catch (e) { console.log((e as Error).constructor.name) }

// A property that holds a function, declared as a property; parameters that are optional, defaulted and rest.
interface Calculator { base: number; apply: (x: number, y?: number) => number; many(...values: number[]): number; scaled?(factor?: number): number }
class ClassCalculator implements Calculator {
  base = 100
  apply(x: number, y = 10): number { return this.base + x * y }
  many(...values: number[]): number { return values.reduce((a, b) => a + b, this.base) }
  scaled(factor = 2): number { return this.base * factor }
}
const calculators: Calculator[] = [
  new ClassCalculator(),
  { base: 1, apply(x, y) { return this.base + x + (y === undefined ? 0.5 : y) }, many() { return arguments.length + this.base } },
  { base: 2, apply: x => x * 2, many: (...values) => values.length, scaled: factor => (factor ?? -1) * 3 },
  { base: 3, apply: Math.max as Calculator["apply"], many: Math.min },
]
console.log(calculators.map(c => [c.apply(1), c.apply(1, 2), c.apply(1, undefined), c.many(), c.many(5), c.many(5, 6, 7), c.scaled?.(), c.scaled?.(4), c.scaled?.(undefined)].join()).join(" | "))

// A generic function over members, and one call site that sees all of them many times.
function longest<T extends Speaker>(list: readonly T[]): T { let best = list[0]; for (const s of list) if (s.speak("").length > best.speak("").length) best = s; return best }
console.log(longest(speakers).id, longest([new ClassSpeaker(1), new LoudSpeaker(22222)]).id, longest([literalShared, literalBound]).id)
let chars = 0
for (let i = 0; i < 39000; i++) { const s = speakers[i % speakers.length]; chars += s.speak("x").length + (s.shout ? s.shout().length : 0) + s.id }
console.log(chars, getterCalls)
