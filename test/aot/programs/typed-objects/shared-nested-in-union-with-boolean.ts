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
interface Either { compile?: boolean | Compile | null }
const madeEither: Either = { compile: madeCompile }
function either(value: Either): string { const compile = value.compile; return compile && typeof compile === "object" ? compile.outfile : String(compile) }
console.log(either(madeEither), either({ compile: true }), either({}))
const inner: Loose = { outfile: "first" }
const outer: any = { compile: inner }
console.log(either(outer))
inner.outfile = "second"
console.log(either(outer), outer.compile === inner)
