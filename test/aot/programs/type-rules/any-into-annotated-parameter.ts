// A value of type `any` is passed to an annotated parameter of an interface type with methods.
interface Speaker { id: number; speak(greeting: string): string }
const literalMethod: Speaker = { id: 1, speak(greeting) { return greeting + " method " + this.id } }
function replacing(s: Speaker): string { return s.speak?.((s.speak = () => "replaced " + s.id, "old")) + " then " + s.speak("new") }
try { console.log(replacing(Object.create(literalMethod))); console.log("inheritor of a compiled object as a Speaker: no error") } catch (e) { console.log("inheritor of a compiled object as a Speaker:", e instanceof TypeError ? "TypeError" : "other " + e) }
class Runner { n = 1; go(x: number): string { return "orig" + x + this.n } get size(): number { return this.n } }
function reparent(r: Runner): number { Object.setPrototypeOf(r, { go() { return "other" }, size: -1 }); return 7 }
const r3 = new Runner()
try { console.log(r3.go?.(reparent(r3))); console.log("another prototype: no error") } catch (e) { console.log("another prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(r3.go(0), r3.size)
