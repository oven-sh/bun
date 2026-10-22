function adder(amount: number): (n: number) => number {
  return n => n + amount;
}

function counter(prefix: string, box: { count: number }): (n: number) => number {
  return n => {
    box.count++;
    return prefix.length * 1000 + box.count * 100 + n;
  };
}

class Machine {
  step: (n: number) => number = adder(1);
  name = "machine";
  run(n: number): number {
    return this.step(this.step(n));
  }
}

function stepOf(m: Machine, n: number): number {
  return m.step(n);
}

const m = new Machine();
const other = new Machine();
const first = m.step;
const box = { count: 0 };

function attempt(body: () => number): string {
  try {
    const result: unknown = body();
    return typeof result === "number" ? String(result) : typeof result + " " + String(result);
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

function report(label: string): void {
  console.log(label + ": " + attempt(() => m.step(1)) + " " + attempt(() => stepOf(m, 1)) + " " + attempt(() => m.run(1)) + " | " + other.step(1) + " " + stepOf(other, 1) + " " + other.run(1) + " | " + box.count + " " + Object.keys(m).join());
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += m.step(i) + stepOf(m, i) + m.run(i) + stepOf(other, i);
console.log("2000 honest rounds: " + sum);
report("before");
Reflect.set(m, "step", adder(10));
report("the same definition with another amount");
Reflect.set(m, "step", counter("abc", box));
report("another definition with other captures");
Reflect.set(m, "step", Math.abs);
report("a built-in");
Reflect.set(m, "step", () => "text");
report("a function that gives a string");
Reflect.set(m, "step", 5);
report("a number");
Reflect.set(m, "step", undefined);
report("undefined");
Reflect.set(m, "step", { call: 1 });
report("an object");
Reflect.set(m, "step", "text");
report("a string");
Reflect.set(m, "step", first);
report("the first one again");

export {};
