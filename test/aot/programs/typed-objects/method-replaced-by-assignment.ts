// A method that the program replaces with a plain assignment (`s.speak = ..`) is called through its interface and its class.
interface Speaker { id: number; speak(greeting: string): string }
function sharedSpeak(this: Speaker, greeting: string): string { return greeting + " shared " + this.id }
class ClassSpeaker implements Speaker {
  constructor(public id: number) {}
  speak(greeting: string): string { return greeting + " class " + this.id }
}
function replacing(s: Speaker): string { return s.speak((s.speak = () => "replaced " + s.id, "old")) + " then " + s.speak("new") }
function speaking(s: Speaker): string { return s.speak("old") + " then " + s.speak("new") }
// `s.speak = ..` is seen by the checker: `speak` is a replaced method, also of the class. (A store that it does not see: type-rules/own-property-shadows-method-computed-key.)
console.log(replacing({ id: 20, speak: sharedSpeak }), "|", speaking(new ClassSpeaker(21)))
const c = new ClassSpeaker(21)
console.log(replacing(c), "|", c.speak("still"), Object.keys(c).join())
c.speak = c.speak.bind(c)
const free = c.speak
console.log(free("bound"), new ClassSpeaker(22).speak("other"))
