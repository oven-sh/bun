// Methods, accessors and static methods keyed by a constant symbol are found on receivers of a known type, through subclasses, super and interfaces.
const kRun = Symbol("run");
const kSize = Symbol("size");
const kMake = Symbol("make");
const kOnly = Symbol("only");
class Task {
  n = 2;
  label?: string;
  [kRun](by: number): number {
    return this.n * by;
  }
  get [kSize](): number {
    return this.n + 100;
  }
  set [kSize](value: number) {
    this.n = value;
  }
  static [kMake](): Task {
    return new Task();
  }
}
class Slow extends Task {
  [kRun](by: number): number {
    return super[kRun](by) + 1;
  }
  [kOnly](): string {
    return "only";
  }
}
function run(task: Task): number {
  return task[kRun](3);
}
function size(task: Task): number {
  task[kSize] = task[kSize] - 99;
  return task[kSize];
}
function has(task: Task): string {
  return [kRun in task, kSize in task, kOnly in task, Object.hasOwn(task, kRun), typeof task[kRun], task[kRun].name].join();
}
function detached(task: Task): number {
  const method = task[kRun];
  return method.call({ n: 5 } as Task, 2);
}
interface Runner {
  [kRun](by: number): number;
}
function viaInterface(runner: Runner): number {
  return runner[kRun](4);
}
(globalThis as { kept?: unknown }).kept = [run, size, has, detached, viaInterface];
const task = Task[kMake]();
const slow = new Slow();
console.log(run(task), run(slow), size(task), size(slow), has(task), has(slow), detached(task));
console.log(viaInterface(task), viaInterface(slow), viaInterface({ [kRun]: by => by * 10 }), viaInterface({ [kRun](by) { return by * 11; } }));
console.log(slow[kOnly](), Reflect.ownKeys(Task.prototype).map(String).join(), Reflect.ownKeys(Slow.prototype).map(String).join(), Reflect.ownKeys(Task).map(String).join(), Reflect.ownKeys(slow).join());
const loose: any = slow;
console.log(loose[kRun](1), loose[kSize], loose[kOnly](), delete loose[kRun], loose[kRun](1));
