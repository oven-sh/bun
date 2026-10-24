function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

type Task = () => number;

function runFirst(tasks: Task[]): number {
  return tasks[0]();
}

function runAt(tasks: Task[], index: number): number {
  return tasks[index]();
}

function runAll(tasks: Task[]): number {
  let total = 0;
  for (let i = 0; i < tasks.length; i++) total += tasks[i]();
  return total;
}

function runAllByForOf(tasks: Task[]): number {
  let total = 0;
  for (const task of tasks) total += task();
  return total;
}

function runAllByForEach(tasks: Task[]): number {
  let total = 0;
  tasks.forEach(task => (total += task()));
  return total;
}

function runWhatIsThere(tasks: Task[]): number {
  let total = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (task) total += task();
  }
  return total;
}

function viaCall(tasks: Task[], index: number): number {
  return tasks[index].call(undefined);
}

function viaLocal(tasks: Task[], index: number): number {
  const task = tasks[index];
  return task() + 1;
}

function kinds(tasks: Task[]): string {
  let text = "";
  for (let i = 0; i < tasks.length; i++) text += (i in tasks ? "" : "absent ") + typeof tasks[i] + ",";
  return text;
}

class Runner {
  tasks: Task[];
  constructor(tasks: Task[]) {
    this.tasks = tasks;
  }
  run(): number {
    let total = 0;
    for (let i = 0; i < this.tasks.length; i++) total += this.tasks[i]();
    return total;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const tasks: Task[] = [() => i, () => 1];
  total += runFirst(tasks) + runAt(tasks, 1) + runAll(tasks) + runAllByForOf(tasks) + runAllByForEach(tasks) + runWhatIsThere(tasks) + viaCall(tasks, 0) + viaLocal(tasks, 1) + new Runner(tasks).run();
}
console.log("2000 honest rounds: " + total);

function study(title: string, make: () => Task[]): void {
  console.log(title + ": " + kinds(make()) + " length " + make().length);
  attempt("  the first", () => runFirst(make()));
  attempt("  at 1", () => runAt(make(), 1));
  attempt("  all", () => runAll(make()));
  attempt("  all by for of", () => runAllByForOf(make()));
  attempt("  all by forEach", () => runAllByForEach(make()));
  attempt("  what is there", () => runWhatIsThere(make()));
  attempt("  by call", () => viaCall(make(), 1));
  attempt("  by a local", () => viaLocal(make(), 1));
  attempt("  in a field", () => new Runner(make()).run());
}

study("honest", () => [() => 1, () => 2, () => 3]);
study("new Array(3)", () => new Array<Task>(3));
study("the middle one is deleted", () => {
  const tasks: Task[] = [() => 1, () => 2, () => 3];
  delete tasks[1];
  return tasks;
});
study("made longer", () => {
  const tasks: Task[] = [() => 1];
  tasks.length = 3;
  return tasks;
});
study("a store past the end", () => {
  const tasks: Task[] = [() => 1];
  tasks[2] = () => 3;
  return tasks;
});
study("the first one is missing", () => {
  const tasks: Task[] = [];
  tasks[1] = () => 2;
  return tasks;
});
study("honest again", () => [() => 4, () => 5]);

export {};
