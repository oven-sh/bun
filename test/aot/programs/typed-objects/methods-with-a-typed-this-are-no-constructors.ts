// A function with a typed `this` that is stored as a member, or that stores nothing first, is no constructor of that type: the fields of the type stay "never observed absent" (`initialization=` in the printed field), and `new` of such a function makes an ordinary object.
// IR+ ^layout L\d+ .*\{name="count" declared=[^{}]* initialization=(SetAtCreation|StoredBeforeEveryRead)
// IR+ ^layout L\d+ .*\{name="step" declared=[^{}]* initialization=(SetAtCreation|StoredBeforeEveryRead)
// IR+ ^layout L\d+ .*\{name="label" declared=[^{}]* initialization=(SetAtCreation|StoredBeforeEveryRead)
// VALIDATED compiles
interface Counter { count: number; step: number; label: string }
function Base(this: any) {}
Base.prototype.bump = function (this: Counter) { this.count += this.step; return this.count }
Base.prototype.setStep = function (this: Counter, step: number) { this.step = step }
const more = { relabel: function (this: Counter, label: string) { this.label = label } }
function describe(this: Counter) { return this.label + ":" + this.count + "/" + this.step }
function make(label: string): Counter {
  const made: Counter = { count: 0, step: 1, label }
  Object.setPrototypeOf(made, Base.prototype)
  return made
}
function total(counters: Counter[]) { let sum = 0; for (const counter of counters) sum += counter.count * counter.step + counter.label.length; return sum }
const all = [make("a"), make("bc")]
const untyped: any = all[1]
untyped.setStep(3); untyped.bump(); untyped.bump()
more.relabel.call(all[0], "first")
console.log(total(all), describe.call(all[0]), describe.call(all[1]), Object.keys(all[1]).join())
function isCounter(this: Counter) { return typeof this === "object" }
const setStep: any = Base.prototype.setStep, relabel: any = more.relabel, asked: any = isCounter
const stepped = new setStep(5), relabeled = new relabel("x"), answered = new asked()
console.log(JSON.stringify(stepped), Object.getPrototypeOf(stepped) === setStep.prototype, JSON.stringify(relabeled), Object.getPrototypeOf(relabeled) === relabel.prototype)
console.log(JSON.stringify(answered), Object.getPrototypeOf(answered) === asked.prototype, "count" in stepped, stepped instanceof setStep)
console.log(describe.call({ label: "plain", count: 1, step: 2 }))
