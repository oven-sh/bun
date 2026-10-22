// A nested object literal has a member whose type is wider than the type the outer `as` cast gives it (`string | undefined` for `string`)
// and lacks an optional member of that type, but the values it holds fit. Reading the nested object through the cast's type gives the
// object as it is, and nothing throws.
interface Compile { outfile: string; target?: string }
interface Build { entrypoints: string[]; compile: Compile; fold?: boolean }
interface Task { name: string; run: () => string; retries?: number }
interface Job { id: number; task: Task }

const knownBuild: Build = { entrypoints: ["known"], compile: { outfile: "known.js", target: "bun" } }
const knownJob: Job = { id: 1, task: { name: "known", run: () => "ran", retries: 2 } }
function describeBuild(build: Build): string { return build.entrypoints.join() + " " + build.compile.outfile + " " + build.compile.target + " " + build.fold }
function describeJob(job: Job): string { return job.id + " " + job.task.name + " " + job.task.run() + " " + job.task.retries }
function maybe(text: string): string | undefined { return knownBuild.entrypoints.length ? text : undefined }

console.log(describeBuild(knownBuild), describeJob(knownJob))
console.log(describeBuild({ entrypoints: ["a"], compile: { outfile: maybe("first.js") } } as Build))
console.log(describeJob({ id: 2, task: { name: maybe("second"), run: () => "ran too" } } as Job))
