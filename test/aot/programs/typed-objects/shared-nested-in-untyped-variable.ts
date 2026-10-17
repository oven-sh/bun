// An object that typed code holds is stored in an object literal that is kept in a variable of type `any`, and the variable is passed to a
// typed function. The declared type of the inner object is looser than the type it is read as there, but the object has everything that
// type requires. It stays the same object, however many members it has: a change made through one reference is seen through the other.
interface Step { name: string; first: number; second: number; third: number; fourth: number; fifth: number; sixth: number; run: () => string }
interface LooseStep { name?: string; first: number; second: number; third: number; fourth: number; fifth: number; sixth: number; run: () => string }
interface Plan { id: number; step: Step }

const knownPlan: Plan = { id: 1, step: { name: "known", first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, run: () => "ran" } }
const knownLoose: LooseStep = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, run: () => "loose" }
function describe(plan: Plan): string {
  const step = plan.step
  return plan.id + " " + step.name + " " + (step.first + step.second + step.third + step.fourth + step.fifth + step.sixth) + " " + step.run()
}
console.log(describe(knownPlan), knownLoose.name, knownLoose.run())

const inner: LooseStep = { name: "first", first: 1, second: 1, third: 1, fourth: 1, fifth: 1, sixth: 1, run: () => "ran too" }
const outer: any = { id: 2, step: inner }
console.log(describe(outer))
inner.name = "second"
inner.sixth = 10
console.log(describe(outer), outer.step === inner)
