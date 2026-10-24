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
Object.defineProperty(m, "step", { value: adder(10), writable: true, enumerable: true, configurable: true });
report("the same definition with another amount");
Object.defineProperty(m, "step", { value: counter("abc", box), writable: true, enumerable: true, configurable: true });
report("another definition with other captures");
Object.defineProperty(m, "step", { value: Math.abs, writable: true, enumerable: true, configurable: true });
report("a built-in");
Object.defineProperty(m, "step", { value: () => "text", writable: true, enumerable: true, configurable: true });
report("a function that gives a string");
Object.defineProperty(m, "step", { value: 5, writable: true, enumerable: true, configurable: true });
report("a number");
Object.defineProperty(m, "step", { value: undefined, writable: true, enumerable: true, configurable: true });
report("undefined");
Object.defineProperty(m, "step", { value: { call: 1 }, writable: true, enumerable: true, configurable: true });
report("an object");
Object.defineProperty(m, "step", { value: "text", writable: true, enumerable: true, configurable: true });
report("a string");
Object.defineProperty(m, "step", { value: first, writable: true, enumerable: true, configurable: true });
report("the first one again");

export {};
