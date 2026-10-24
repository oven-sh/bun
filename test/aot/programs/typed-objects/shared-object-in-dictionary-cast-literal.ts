// An object that typed code holds is a property of an object literal that is cast with `as` to a type whose member is a dictionary
// (`Record<string, Compile>`). The declared type of the object is looser than the dictionary's value type, but the object has everything
// that type requires. Reading it out of the dictionary does not throw, and it stays the same object.
interface Compile { outfile: string; target?: string }
interface Loose { outfile?: string; target?: string }
interface Targets { byName: Record<string, Compile> }

const known: Targets = { byName: { first: { outfile: "known.js", target: "bun" } } }
const knownLoose: Loose = { target: "node" }
function outfileOf(targets: Targets, name: string): string { return targets.byName[name].outfile }
console.log(outfileOf(known, "first"), knownLoose.target)

const held: Loose = { outfile: "a.js" }
const targets = { byName: { held } } as Targets
console.log(outfileOf(targets, "held"))
held.outfile = "b.js"
console.log(outfileOf(targets, "held"), (targets.byName.held as unknown) === (held as unknown))
