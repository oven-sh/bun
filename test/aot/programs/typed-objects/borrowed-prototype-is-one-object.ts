// A plain object that is the prototype of another object enters a typed place. It stays as it is, and typed code, untyped code and the heir all see one object.
interface Compile { outfile: string; target?: string }
interface Build { entrypoints: string[]; compile: Compile }
function describeBuild(build: Build): string { return build.entrypoints.join() + " " + build.compile.outfile + " " + build.compile.target }
function rename(build: Build, name: string): void { build.compile.outfile = name }
function retarget(build: Build, target: string): void { build.compile.target = target }
function same(build: Build, other: unknown): boolean { return build.compile === other }
function untypedOptions(): any { const options: any = {}; options.outfile = "out.js"; return options }
function tell(name: string, f: () => unknown): void { let text: string; try { text = String(f()) } catch (e) { text = e instanceof Error ? e.name + ": " + e.message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "") : String(e) } console.log(name + ": " + text) }
function make(): { options: any; heir: any; build: any } { const options = untypedOptions(); const heir = Object.create(options); return { options, heir, build: { entrypoints: ["a.ts"], compile: options } } }
tell("read", () => { const { heir, build } = make(); return describeBuild(build) + " | heir " + heir.outfile });
tell("identity", () => { const { options, heir, build } = make(); describeBuild(build); return same(build, options) + " " + (build.compile === options) + " " + (Object.getPrototypeOf(heir) === options) + " " + (Object.getPrototypeOf(heir) === build.compile) });
tell("an untyped store is seen by typed code and the heir", () => { const { options, heir, build } = make(); describeBuild(build); options.outfile = "untyped.js"; return describeBuild(build) + " | heir " + heir.outfile + " | options " + options.outfile });
tell("a typed store is seen by untyped code and the heir", () => { const { options, heir, build } = make(); describeBuild(build); rename(build, "typed.js"); return describeBuild(build) + " | heir " + heir.outfile + " | options " + options.outfile });
tell("a typed store of an absent member", () => { const { options, heir, build } = make(); describeBuild(build); retarget(build, "bun"); return describeBuild(build) + " | heir " + heir.target + " | options " + options.target + " | keys " + Object.keys(options) });
tell("an untyped store of an absent member", () => { const { options, heir, build } = make(); describeBuild(build); options.target = "node"; return describeBuild(build) + " | heir " + heir.target + " | keys " + Object.keys(options) });
tell("an extra member added later", () => { const { options, heir, build } = make(); describeBuild(build); options.extra = 1; return describeBuild(build) + " | heir " + heir.extra + " | keys " + Object.keys(options) + " | for-in of the heir " + (() => { const names: string[] = []; for (const name in heir) names.push(name); return names })() });
tell("a member deleted later", () => { const { options, heir, build } = make(); describeBuild(build); delete options.outfile; return "heir " + heir.outfile + " | in " + ("outfile" in heir) + " | " + describeBuild(build) });
tell("the heir shadows", () => { const { options, heir, build } = make(); describeBuild(build); heir.outfile = "own.js"; return describeBuild(build) + " | heir " + heir.outfile + " | options " + options.outfile });
tell("an heir made after", () => { const { options, build } = make(); describeBuild(build); const late = Object.create(options); rename(build, "typed.js"); return late.outfile + " " + Object.getPrototypeOf(late).outfile });
tell("the heir itself is given", () => { const { heir } = make(); const build: any = { entrypoints: ["h.ts"], compile: heir }; return describeBuild(build) });
tell("hot", () => { const { options, heir, build } = make(); let s = ""; for (let i = 0; i < 20000; i++) { rename(build, "n" + (i & 3)); s = heir.outfile + options.outfile } return s + " " + describeBuild(build) });
