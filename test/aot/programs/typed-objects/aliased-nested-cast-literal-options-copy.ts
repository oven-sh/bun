// Options are normalized the way many build tools do it: an optional nested object is copied with one member filled in, assigned back to the
// parameter it came from, and stored in a literal that is cast to the full type.
interface Compile { target?: string; outfile: string; icon?: string }
interface Minify { whitespace?: boolean; syntax?: boolean }
interface Config { entrypoints: string[]; external?: string[]; compile?: boolean | Compile; minify?: boolean | Minify; fold?: boolean; target?: string; define?: Record<string, string> }
const madeCompile: Compile = { outfile: "made" }
const madeConfig: Config = { entrypoints: ["made"] }
function use(config: Config): string {
  const compile = config.compile
  return config.entrypoints.join() + " " + (typeof compile === "object" ? compile.outfile + " " + compile.target : String(compile)) + " " + config.fold + " " + config.target
}
console.log(use(madeConfig), madeCompile.outfile)
function build(compile: boolean | { target?: string; outfile?: string } | undefined, outfile: string, fold: boolean | undefined, external: string[] | undefined): string {
  if (compile && typeof compile === "object") compile = { ...compile, outfile: outfile }
  const config: Config = {
    entrypoints: ["a", ...(external ?? [])],
    external,
    minify: { whitespace: true, syntax: false },
    ...(fold === undefined ? {} : { fold: fold }),
    target: "bun",
    define: {},
    compile,
  } as Config
  return use(config)
}
console.log(build({ target: "t" }, "out", true, ["x"]))
console.log(build({ target: "t" }, "out", undefined, undefined))
console.log(build(true, "out", true, undefined))
console.log(build(undefined, "out", false, []))
