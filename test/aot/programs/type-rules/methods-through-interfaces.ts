// Interfaces with methods, implemented by literals, classes, inheriting objects and proxies, and methods called with another object as `this`.
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
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function talk(s: Speaker): string { return s.speak("hi") + "|" + (s.shout?.() ?? "-") + "|" + ("shout" in s) + "|" + Object.keys(s).join("") }
const literalMethod: Speaker = { id: 1, speak(greeting) { return greeting + " method " + this.id } }
const literalArrow: Speaker = { id: 2, speak: greeting => greeting + " arrow", shout: () => "arrow shout" }
attempt("an heir of a literal with the methods", () => { const inherited: Speaker = Object.assign(Object.create({ speak: sharedSpeak, shout(this: Speaker) { return "proto shout " + this.id } }), { id: 11 }); return talk(inherited) })
attempt("an heir of a Speaker", () => talk(Object.create(literalMethod)))
// A proxy does not have the type of its target, and is accepted unchanged.
attempt("a proxy", () => { const proxied: Speaker = new Proxy<Speaker>({ id: 13, speak: sharedSpeak }, {}); return talk(proxied) })
// A method takes for `this` whatever object the call gives it: `this` of a method is not tested.
attempt("a method of an extending class on a literal", () => new LoudSpeaker(5).speak.call(literalArrow, "d"))
attempt("a method of a literal on another literal", () => literalMethod.speak.call(literalArrow, "d"))
attempt("a method of a literal on an object of a class", () => literalMethod.speak.call(new LoudSpeaker(5), "d"))
