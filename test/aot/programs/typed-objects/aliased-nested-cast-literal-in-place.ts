// An object that is also referenced elsewhere is stored in an object literal, and the literal is cast with `as`.
// The declared type of the inner object is looser than the type the cast gives it, but the object has everything
// that type requires. It stays the same object: a change made through one reference is visible through the other.
interface Compile { outfile: string; target?: string }
interface Loose { outfile?: string; target?: string }
interface Build { entrypoints: string[]; compile: Compile; fold?: boolean }
const madeCompile: Compile = { outfile: "made" }
const madeBuild: Build = { entrypoints: ["made"], compile: madeCompile }
const madeLoose: Loose = { target: "made" }
function out(build: Build): string { return build.entrypoints.join() + " " + build.compile.outfile + " " + build.compile.target + " " + build.fold }
console.log(out(madeBuild), madeLoose.target)
const inner: Loose = { outfile: "first" }
const build = { entrypoints: ["a"], compile: inner } as Build
console.log(out(build))
inner.outfile = "second"
console.log(out(build), (build.compile as unknown) === (inner as unknown))
build.compile.outfile = "third"
console.log(inner.outfile)
