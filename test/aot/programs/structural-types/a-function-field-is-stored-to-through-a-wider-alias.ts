function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

class Task {
  name = "task";
  run: () => number = () => 1;
  priority = 5;
  result(): number {
    return this.run() + 1;
  }
}

function put<T>(box: { run: (() => number) | T }, value: T): void {
  box.run = value;
}

function call(box: { run: () => number }): number {
  return box.run();
}

function callPlusOne(box: { run: () => number }): number {
  return box.run() + 1;
}

function callTwice(box: { run: () => number }): number {
  let total = 0;
  for (let i = 0; i < 2; i++) total += box.run();
  return total;
}

function detached(box: { run: () => number }): number {
  const run = box.run;
  return run();
}

function kind(box: { run: () => number }): string {
  return typeof box.run;
}

function byCall(box: { run: () => number }): number {
  return box.run.call(undefined);
}

class Maker {
  made = 7;
}

const log: string[] = [];
const ways: [string, (box: { run: () => number }) => void][] = [
  ["another honest function", box => put(box, () => 2)],
  ["a function that returns a string", box => put(box, () => "two")],
  ["a function that returns nothing", box => put(box, () => {})],
  ["a function that wants an argument", box => put(box, (value: number) => value * 2)],
  ["a function that reads this", box => put(box, function (this: { priority?: number } | undefined) { return this === undefined ? -1 : this.priority; })],
  ["an async function", box => put(box, async () => 3)],
  ["a generator function", box => put(box, function* () { yield 3; })],
  ["a class", box => put(box, Maker)],
  ["a bound function", box => put(box, Math.max.bind(null, 4, 5))],
  ["a built-in function", box => put(box, Math.random.name.length > 0 ? Math.abs : Math.abs)],
  ["a callable proxy", box => put(box, new Proxy(() => 6, { apply: () => (log.push("apply"), 60) }))],
  ["null", box => put(box, null)],
  ["undefined", box => put(box, undefined)],
  ["a number", box => put(box, 5)],
  ["a string", box => put(box, "run")],
  ["an object with call", box => put(box, { call: () => 8 })],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const task = new Task();
  const literal = { run: () => i };
  warm += call(task) + callPlusOne(task) + callTwice(task) + detached(task) + kind(task).length + byCall(task) + task.result() + call(literal) + callTwice(literal);
}
console.log("after 2000 honest tasks", warm);

for (const [name, store] of ways) {
  const stored = (): Task => {
    const task = new Task();
    store(task);
    return task;
  };
  attempt(name + ": typeof", () => kind(stored()));
  attempt(name + ": called", () => {
    const result: unknown = call(stored());
    return typeof result === "object" && result !== null ? result.constructor.name : result;
  });
  attempt(name + ": called, plus one", () => typeof callPlusOne(stored()) + " " + String(callPlusOne(stored())).slice(0, 12));
  attempt(name + ": called twice", () => typeof callTwice(stored()));
  attempt(name + ": detached", () => typeof detached(stored()));
  attempt(name + ": by call", () => typeof byCall(stored()));
  attempt(name + ": its own method", () => typeof stored().result());
  attempt(name + ": the other fields", () => [stored().name, stored().priority]);
}
console.log("traps", log.length);
