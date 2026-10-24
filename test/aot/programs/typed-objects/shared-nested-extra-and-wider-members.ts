// An object that typed code holds is stored in an object that travels as `any` before a typed function first holds it. The inner object has a
// member more than the type it is read as there, and another member is declared wider than that type allows, but holds a value that fits.
// It stays the same object.
interface Compile { outfile: string; target?: string }
interface Build { entrypoints: string[]; compile: Compile }
const madeCompile: Compile = { outfile: "made" }
const madeBuild: Build = { entrypoints: ["made"], compile: madeCompile }
function out(build: Build): string { return build.entrypoints.join() + " " + build.compile.outfile + " " + build.compile.target }
function pick(): string | undefined { return madeBuild.entrypoints.length ? "first" : undefined }
console.log(out(madeBuild))
const inner = { outfile: pick() ?? 1, extra: 1 }
const outer: any = { entrypoints: ["a"], compile: inner }
console.log(out(outer))
inner.outfile = "second"
console.log(out(outer), outer.compile === inner, inner.extra)
console.log(out({ entrypoints: ["b"], compile: { outfile: pick() ?? 1, extra: 2 } } as Build))
