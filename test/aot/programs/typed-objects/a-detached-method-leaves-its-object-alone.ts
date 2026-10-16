// A method taken off its object is called without `this`, directly and from an arrow function: a TypeError each time, and the object it came from is as it was.
class Counter { count = 0; step = 1; bump(): number { this.count += this.step; return this.count } }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const c = new Counter()
const bump = c.bump
console.log(attempt(bump), attempt(() => bump()), c.count)
