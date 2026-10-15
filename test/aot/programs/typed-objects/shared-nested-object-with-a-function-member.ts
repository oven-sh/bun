// An object that typed code holds is stored in an object that travels as `any` before a typed function first holds it. The declared type of
// the inner object is looser than the type it is read as there, and one of its members is a function. It stays the same object.
interface Task { name: string; run: () => string }
interface LooseTask { name?: string; run: () => string }
interface Job { id: number; task: Task }
const madeTask: Task = { name: "made", run: () => "ran" }
const madeJob: Job = { id: 1, task: madeTask }
const madeLoose: LooseTask = { run: () => "loose" }
function use(job: Job): string { return job.id + " " + job.task.name + " " + job.task.run() }
console.log(use(madeJob), madeLoose.run())
const inner: LooseTask = { name: "first", run: () => "inner" }
const outer: any = { id: 2, task: inner }
console.log(use(outer))
inner.name = "second"
console.log(use(outer), outer.task === inner)
