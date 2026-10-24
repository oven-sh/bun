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
interface Many { list: Compile[] }
const madeMany: Many = { list: [madeCompile] }
function outs(many: Many): string { return many.list.map(compile => compile.outfile).join() }
console.log(outs(madeMany))
const inner: Loose = { outfile: "first" }
const outer: any = { list: [inner] }
console.log(outs(outer))
inner.outfile = "second"
console.log(outs(outer), outer.list[0] === inner)
