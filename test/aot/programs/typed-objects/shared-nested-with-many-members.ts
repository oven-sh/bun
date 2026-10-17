// An object that typed code holds is stored in an object literal that passes through a function returning `any` before a typed function first
// holds it. The inner object has eight or nine members, one of them a function. Its declared type is looser than the type it is read as
// there, but it has everything that type requires. It stays the same object: a change made through one reference is seen through the other.
interface Step { name: string; first: number; second: number; third: number; fourth: number; fifth: number; sixth: number; run: () => string }
interface LooseStep { name?: string; first: number; second: number; third: number; fourth: number; fifth: number; sixth: number; run: () => string }
interface Plan { id: number; step: Step }

const knownPlan: Plan = { id: 1, step: { name: "known", first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, run: () => "ran" } }
const knownLoose: LooseStep = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, run: () => "loose" }
function hide(value: unknown): any { return value }
function maybe(text: string): string | undefined { return knownPlan.id ? text : undefined }
function describe(plan: Plan): string {
  const step = plan.step
  return plan.id + " " + step.name + " " + (step.first + step.second + step.third + step.fourth + step.fifth + step.sixth) + " " + step.run()
}
console.log(describe(knownPlan), knownLoose.name, knownLoose.run())

const inner: LooseStep = { name: "first", first: 1, second: 1, third: 1, fourth: 1, fifth: 1, sixth: 1, run: () => "ran too" }
const outer = hide({ id: 2, step: inner })
console.log(describe(outer))
inner.name = "second"
console.log(describe(outer), outer.step === inner)

const wider = { name: maybe("third"), first: 1, second: 1, third: 1, fourth: 1, fifth: 1, sixth: 1, seventh: 7, run: () => "ran again" }
const other = hide({ id: 3, step: wider })
console.log(describe(other))
wider.name = "fourth"
console.log(describe(other), other.step === wider, wider.seventh)
