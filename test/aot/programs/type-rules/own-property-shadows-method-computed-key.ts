// An own property with the name of a method of the object's class, stored by a computed key, shadows the method.
interface Speaker { id: number; speak(greeting: string): string }
class ClassSpeaker implements Speaker {
  constructor(public id: number) {}
  speak(greeting: string): string { return greeting + " class " + this.id }
}
const c = new ClassSpeaker(21)
const names: string[] = ["speak"]
try { (c as any)[names[0]] = () => "replaced"; console.log("own property named like a method: no error") } catch (e) { console.log("own property named like a method:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(c.speak("still"), Object.keys(c).join())
// What the name holds, bound to the object, is stored through the typed reference.
try { c.speak = c.speak.bind(c); console.log("the method bound to the object: no error") } catch (e) { console.log("the method bound to the object:", e instanceof TypeError ? "TypeError" : "other " + e) }
const free = c.speak
console.log(free("bound"))
