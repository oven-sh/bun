// A name that the classes of an object do not declare is asked of the run time once for each shape of receiver: it is absent, or it comes from beyond the classes. The prototypes need not make their members for that. What was learnt ends when the name arrives somewhere on the way.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
class Task { id = 1; run() { return "ran " + this.id; } stop() { return "stopped"; } pause() { return "paused"; } resume() { return "resumed"; } }
class Job extends Task { queue = "main"; submit() { return this.queue; } }
class Cron extends Job { every = 60; }
const isThenable = value => typeof value.then === "function";
function thenables(value, turns) { let n = 0; for (let i = 0; i < turns; i++) n += isThenable(value) ? 1 : 0; return n; }
function marks(value, turns) { let seen; for (let i = 0; i < turns; i++) seen = value.$$mark; return seen; }
function texts(value, turns) { let text = ""; for (let i = 0; i < turns; i++) text = value.toString(); return text; }
function owns(value, turns) { let n = 0; for (let i = 0; i < turns; i++) n += value.hasOwnProperty("id") ? 1 : 0; return n; }
const asked = () => count("operationAOTGetByIdAndCache");
const receivers = [new Task(), new Job(), new Cron()];
let most = 0;
const results = [];
for (const read of [thenables, marks, texts, owns]) {
  for (const receiver of receivers) {
    const before = asked();
    results.push(read(receiver, 500));
    most = Math.max(most, asked() - before);
  }
}
console.log(results.join());
console.log(most <= 3 ? "no name was asked of the run time more than three times" : "the run time was asked " + most + " times for one name on one class");
const [task, job, cron] = receivers;
console.log(task.run(), job.submit(), cron.run(), cron.pause());

// The name arrives: far above, on the nearest prototype, on the object.
Task.prototype.$$mark = "task";
console.log(marks(task, 5), marks(job, 5), marks(cron, 5));
Cron.prototype.$$mark = "cron";
console.log(marks(task, 5), marks(job, 5), marks(cron, 5));
job.$$mark = "own";
console.log(marks(task, 5), marks(job, 5), marks(cron, 5), marks(new Job(), 5));
delete Cron.prototype.$$mark;
delete Task.prototype.$$mark;
console.log(marks(task, 5), marks(job, 5), marks(cron, 5), marks(new Job(), 5));
Job.prototype.then = function (resolve) { resolve("done"); };
console.log(thenables(task, 5), thenables(job, 5), thenables(cron, 5));
Job.prototype.toString = function () { return "a job in " + this.queue; };
console.log(texts(task, 5), texts(job, 5), texts(cron, 5));
Object.defineProperty(Task.prototype, "hasOwnProperty", { get() { return () => false; }, configurable: true });
console.log(owns(task, 5), owns(cron, 5), owns({ id: 1 }, 5));

// Classes above a class that has been looked at, and the other way round.
class Root { root() { return "root"; } }
class Trunk extends Root { trunk() { return "trunk"; } }
class Twig extends Trunk { twig() { return "twig"; } }
function leaves(value, turns) { let seen; for (let i = 0; i < turns; i++) seen = value.leaf; return seen; }
function roots(value, turns) { let text = ""; for (let i = 0; i < turns; i++) text = value.root(); return text; }
console.log(Object.keys(Trunk.prototype).length, Object.getOwnPropertyNames(Trunk.prototype).join());
const twig = new Twig();
console.log(leaves(twig, 100), roots(twig, 100));
Root.prototype.leaf = "on the root";
console.log(leaves(twig, 100), leaves(new Trunk(), 100));
Twig.prototype.root = () => "from the twig";
console.log(roots(twig, 100), roots(new Trunk(), 100));
class Orphan extends null { static make() { return Object.create(Orphan.prototype); } hello() { return "hello"; } }
function missings(value, turns) { let seen = 0; for (let i = 0; i < turns; i++) seen = value.missing; return seen; }
const orphan = Orphan.make();
console.log(missings(orphan, 100), orphan.hello(), typeof orphan.toString);
Orphan.prototype.missing = "found";
console.log(missings(orphan, 100));
if (typeof gc === "function") gc(); else if (typeof Bun !== "undefined") Bun.gc(true);
console.log(marks(new Cron(), 100), thenables(new Cron(), 100), leaves(new Twig(), 100));
