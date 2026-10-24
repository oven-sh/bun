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
}
class Task {
  id: number = 1;
  runTwice(): number {
    return this.run(1) + this.run(2);
  }
}

class Doubles extends Task {
  run(n: number): number {
    return n * 2;
  }
}

class Adds extends Task {
  step: number = 3;
  run(n: number): number {
    return n + this.step;
  }
}

class Forgets extends Task {
  other: number = 4;
}

function runOf(task: Task, n: number): number {
  return task.run(n);
}

show("the first call gets the base class", () => runOf(new Task(), 1));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += runOf(i % 2 === 0 ? new Doubles() : new Adds(), i) + new Doubles().runTwice();
show("2000 that have it", () => sum);
show("the base class", () => runOf(new Task(), 1));
show("a subclass that forgot", () => runOf(new Forgets(), 1));
show("the base class, in its own method", () => new Task().runTwice());
show("a subclass that forgot, in the inherited method", () => new Forgets().runTwice());
show("one that has it again", () => [runOf(new Doubles(), 4), runOf(new Adds(), 4), new Adds().runTwice()]);

show("five in a row", () => {
  const seen: string[] = [];
  for (const task of [new Doubles(), new Task(), new Adds(), new Forgets(), new Doubles()]) {
    try {
      seen.push(String(runOf(task, 10)));
    } catch (error) {
      seen.push(error instanceof TypeError ? "TypeError" : "another error");
    }
  }
  return seen;
});

const own = new Task();
own.run = n => n - 1;
show("an own function stands in", () => [runOf(own, 1), own.runTwice(), Object.keys(own)]);
show("another instance still has none", () => runOf(new Task(), 1));

Task.prototype.run = function (this: Task, n: number): number {
  return n + this.id * 100;
};
show("after the prototype gets one: the base class", () => runOf(new Task(), 1));
show("after the prototype gets one: the one that forgot", () => [runOf(new Forgets(), 1), new Forgets().runTwice()]);
show("after the prototype gets one: the others", () => [runOf(new Doubles(), 4), runOf(new Adds(), 4), runOf(own, 1)]);
