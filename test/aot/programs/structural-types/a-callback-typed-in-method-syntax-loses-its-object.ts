function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

interface Task {
  weight: number;
  run(): number;
  describe(prefix: string): string;
}
interface Api {
  load: () => number;
  name: string;
}

class Heavy implements Task {
  weight: number = 100;
  run(): number {
    return this.weight;
  }
  describe(prefix: string): string {
    return prefix + this.weight;
  }
}
class Service {
  name: string = "service";
  hits: number = 0;
  load(): number {
    return ++this.hits;
  }
}

const literal: Task = {
  weight: 5,
  run() {
    return this.weight;
  },
  describe(prefix) {
    return prefix + this.weight;
  },
};

function exec(run: Task["run"]): number {
  return run();
}
function execWith(describe: Task["describe"], prefix: string): string {
  return describe(prefix);
}
function viaInterface(task: Task): number {
  const { run } = task;
  return run();
}
function honest(task: Task): number {
  return task.run();
}
function useApi(api: Api): number {
  const load = api.load;
  return load();
}
function useApiHonestly(api: Api): number {
  return api.load();
}

const heavy = new Heavy();
show("honest class", () => honest(heavy));
show("honest literal", () => honest(literal));
show("exec class", () => exec(heavy.run));
show("exec literal", () => exec(literal.run));
show("execWith class", () => execWith(heavy.describe, "w"));
show("execWith literal", () => execWith(literal.describe, "w"));
show("viaInterface class", () => viaInterface(heavy));
show("viaInterface literal", () => viaInterface(literal));
show("exec an arrow", () => exec(() => heavy.run()));

const mixed: Task = { weight: 1, run: heavy.run, describe: literal.describe };
show("a task made of other tasks' methods: run", () => mixed.run());
show("a task made of other tasks' methods: describe", () => mixed.describe("m"));

const service = new Service();
show("a method for a function-typed member: honest", () => useApiHonestly(service));
show("a method for a function-typed member: taken off", () => useApi(service));
show("an arrow for the same member", () => useApi({ name: "arrow", load: () => 5 }));
show("hits", () => service.hits);

let total = 0;
for (let i = 0; i < 2000; i++) total += honest(i % 2 === 0 ? heavy : literal);
show("2000 honest runs", () => total);
show("then taken off", () => viaInterface(heavy));
show("then honest", () => honest(heavy));
