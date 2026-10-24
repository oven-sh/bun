// A function that stops and goes on again meets the odd value in front of, between and behind its stops.
type Job = { id: number; cost: number };
async function work(job: Job, log: string[]): Promise<number> {
    log.push("start " + job.id);
    const before = job.cost;
    await null;
    log.push("middle " + job.id);
    const after = job.cost;
    await Promise.resolve(1);
    return before + after + job.id;
}
function* steps(job: Job): Generator<number, string, number> {
    let sum = job.cost;
    const got = yield sum;
    sum += job.cost + got;
    const more = yield sum;
    return job.id + ":" + (sum + more + job.cost);
}
const lines: string[] = [];
const log: string[] = [];
function drive(job: Job): string {
    const run = steps(job);
    return [run.next().value, run.next(10).value, run.next(100).value].join();
}
for (let round = 0; round < 300; round++) {
    await work({ id: round, cost: 1 }, []);
    drive({ id: round, cost: 2 });
}
let reads = 0;
for (const job of [{ id: 1, cost: 2 }, { cost: 2, id: 1 }, { id: 2, get cost() { return ++reads; } }, { id: "three", cost: 4 }, { id: 4, cost: 0.5 }, Object.create({ id: 5, cost: 6 })]) {
    lines.push(String(await work(job as Job, log)));
    lines.push(drive(job as Job));
}
lines.push((await Promise.all([{ id: 1, cost: 1 }, { cost: 1, id: 2 }, { id: 3, cost: 1 }].map(job => work(job as Job, log)))).join());
console.log(lines.join("\n"));
console.log(log.join(" "));
