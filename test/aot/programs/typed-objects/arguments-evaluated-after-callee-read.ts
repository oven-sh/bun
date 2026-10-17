// The callee of a method call is read before the arguments are evaluated, so an argument that replaces the method has no effect on the call.
interface Speaker { id: number; speak(greeting: string): string }
function sharedSpeak(this: Speaker, greeting: string): string { return greeting + " shared " + this.id }
class ClassSpeaker implements Speaker {
  constructor(public id: number) {}
  speak(greeting: string): string { return greeting + " class " + this.id }
}
class FieldSpeaker implements Speaker {
  id = 6
  speak = (greeting: string): string => greeting + " field " + this.id
}
const literalMethod: Speaker = { id: 1, speak(greeting) { return greeting + " method " + this.id } }
function replacing(s: Speaker): string { return s.speak?.((s.speak = () => "replaced " + s.id, "old")) + " then " + s.speak("new") }
function speaking(s: Speaker): string { return s.speak?.("old") + " then " + s.speak("new") }
// What gives an object another prototype, or passes an object that inherits from a compiled one: type-rules/any-into-annotated-parameter.
console.log(replacing({ id: 20, speak: sharedSpeak }), "|", speaking(new ClassSpeaker(21)), "|", replacing(new FieldSpeaker()), "|", replacing(literalMethod), "|", replacing(new ClassSpeaker(22)))
class Runner { n = 1; go(x: number): string { return "orig" + x + this.n } get size(): number { return this.n } }
function bump(r: Runner): number { r.n++; return 5 }
const r1 = new Runner(), r2 = new Runner()
console.log(r1.go?.(bump(r1)), r1.go(0), r2.go?.(bump(r1)), r2.size, r1.size)
// The arguments are evaluated after the callee is read. The checker sees both stores, so `go` is a replaced method.
function patchOwn(r: Runner): number { (r as any).go = () => "own"; return 5 }
function patchClass(): number { Runner.prototype.go = function () { return "class" }; return 6 }
const r4 = new Runner(), r5 = new Runner()
console.log(r4.go?.(patchOwn(r4)), r5.go?.(patchClass()), r4.go(0), r5.go(0), new Runner().go(0), Object.keys(r4).join())
