function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Task {
  run(n: number): number;
  title(): string;
}
class Task {
  id: number = 1;
  runTwice(): number {
    return this.run(1) + this.run(2);
  }
}

class Careful extends Task {
  run(n: number): number {
    return super.run(n) + 1;
  }
}

function runOf(task: Task, n: number): number {
  return task.run(n);
}

const log: string[] = [];
function noted(n: number): number {
  log.push("argument " + n);
  return n;
}

const task = new Task();
show("read", () => task.run);
show("typeof", () => typeof task.run);
show("called", () => task.run(1));
show("called, and the argument ran first", () => task.run(noted(5)));
show("the log", () => log.join());
show("called if there", () => task.run?.(1));
show("another one", () => task.title());
show("its result used", () => task.title().length);
show("call", () => task.run.call(task, 1));
show("taken off and called", () => {
  const { run } = task;
  return run(1);
});
show("by a computed name", () => {
  const names: ("run" | "title")[] = ["run", "title"];
  return names.map(name => typeof task[name]);
});
show("in a method", () => task.runTwice());
show("through a function", () => runOf(task, 1));
show("by super", () => new Careful().run(1));
show("the subclass through the same function", () => runOf(new Careful(), 1));
show("on the prototype", () => Task.prototype.run);
show("names of the prototype", () => Object.getOwnPropertyNames(Task.prototype));
show("in", () => "run" in task);
show("keys", () => Object.keys(task));
show("as a callback", () => [1, 2].map(task.run));
show("in a loop", () => {
  let failures = 0;
  for (let i = 0; i < 2000; i++) {
    try {
      runOf(task, i);
    } catch {
      failures++;
    }
  }
  return failures;
});
