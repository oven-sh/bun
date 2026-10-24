function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "caught " + (error instanceof Error ? error.constructor.name : text(error));
}

const trail: string[] = [];

type Task = () => void;

const tasks: [string, Task][] = [
  ["returns nothing", () => {}],
  ["returns a number", () => 5],
  ["is async", async () => {
    trail.push("async task starts");
    await null;
    trail.push("async task ends");
    return "async result";
  }],
  ["returns a promise", () => Promise.resolve({ from: "promise" })],
  ["returns a thenable", () => ({
    then(resolve: (value: string) => void): void {
      trail.push("then of the task's result");
      resolve("thenable result");
    },
  })],
  ["returns a rejection", () => Promise.reject(new RangeError("task"))],
  ["returns a function", () => () => 1],
];

async function runAwaited(task: Task): Promise<string> {
  try {
    const result: void = await task();
    return text(result) + ", undefined: " + (result === undefined);
  } catch (error) {
    return failure(error);
  }
}

async function runReturned(task: Task): Promise<void> {
  return task();
}

function runStored(task: Task): string {
  const result: void = task();
  const kept: void[] = [result];
  const seen: unknown = result;
  if (seen instanceof Promise) seen.catch(() => {});
  return typeof result + ", in a list " + typeof kept[0] + ", a promise " + (seen instanceof Promise);
}

for (const [label, task] of tasks) {
  trail.length = 0;
  console.log(label + ", awaited: " + (await runAwaited(task)) + " [" + trail.join(", ") + "]");
  trail.length = 0;
  console.log(label + ", returned from an async function: " + (await runReturned(task).then(text, failure)) + " [" + trail.join(", ") + "]");
  console.log(label + ", stored: " + runStored(task));
  await null;
  await null;
}

trail.length = 0;
[1, 2, 3].forEach(async n => {
  trail.push("start " + n);
  await null;
  trail.push("end " + n);
});
trail.push("forEach is over");
await null;
await null;
console.log("forEach with an async function: " + trail.join(", "));

function onEach(items: number[], visit: (n: number) => void): void[] {
  const results: void[] = [];
  for (const n of items) results.push(visit(n));
  return results;
}
const collected = onEach([1, 2], async n => n * 2);
console.log("collected: " + collected.map(r => typeof r).join() + ", settled " + text(await Promise.all(collected)));

class Runner {
  last: void = undefined;
  hook: Task = () => {};
  async run(): Promise<string> {
    this.last = this.hook();
    const settled: void = await this.last;
    return typeof this.last + " then " + text(settled);
  }
}
const runner = new Runner();
console.log("a field, honest: " + (await runner.run()));
runner.hook = async () => 7;
console.log("a field, async: " + (await runner.run()));

export {};
