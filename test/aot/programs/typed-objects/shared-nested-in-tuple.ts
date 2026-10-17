// An object that typed code holds is stored in an object that travels as `any` or `unknown` before a typed function first holds it. The declared
// type of the inner object is looser than the type it is read as there, but the object has everything that type requires. It stays the same
// object: a change made through one reference is seen through the other.
interface Compile { outfile: string; target?: string }
interface Loose { outfile?: string; target?: string }
interface Build { entrypoints: string[]; compile: Compile; fold?: boolean }
const madeCompile: Compile = { outfile: "made" }
const madeBuild: Build = { entrypoints: ["made"], compile: madeCompile }
const madeLoose: Loose = { target: "made" }
function hide(value: unknown): any { return value }
function out(build: Build): string { return build.entrypoints.join() + " " + build.compile.outfile + " " + build.compile.target + " " + build.fold }
console.log(out(madeBuild), madeLoose.target)
interface Pair { pair: [Compile, number] }
const madePair: Pair = { pair: [madeCompile, 1] }
function first(value: Pair): string { return value.pair[0].outfile }
console.log(first(madePair))
const inner: Loose = { outfile: "first" }
const outer: any = { pair: [inner, 1] }
console.log(first(outer))
inner.outfile = "second"
console.log(first(outer), outer.pair[0] === inner)
