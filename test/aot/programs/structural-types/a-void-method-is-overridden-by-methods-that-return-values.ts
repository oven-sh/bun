function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

class Step {
  runs = 0;
  run(): void {
    this.runs++;
  }
}

class Counts extends Step {
  run(): number {
    return ++this.runs;
  }
}

class Names extends Step {
  run(): string {
    this.runs++;
    return "named";
  }
}

class Chains extends Step {
  run(): this {
    this.runs++;
    return this;
  }
}

class Zero extends Step {
  run(): number {
    this.runs++;
    return 0;
  }
}

interface Runnable {
  run(): void;
}

const literal: Runnable = { run: () => [1, 2] };

class Ledger {
  last: void = undefined;
  all: void[] = [];
}

function once(step: Runnable): void {
  return step.run();
}

function throughThree(step: Runnable): void {
  const a = (): void => step.run();
  const b = (): void => a();
  const c = (): void => b();
  return c();
}

function compare(step: Runnable): string {
  const result = step.run();
  return "undefined " + (result === undefined) + ", typeof " + typeof result + ", or default " + text(result ?? "default") + ", template " + `<${result}>` + ", json " + JSON.stringify([result]) + ", twice the same " + (step.run() === step.run());
}

function keep(step: Runnable, record: Ledger): string {
  record.last = step.run();
  record.all.push(record.last);
  return text(record.last) + " " + Object.keys(record).join();
}

let warm = 0;
const plain = new Step();
for (let i = 0; i < 2000; i++) if (once(plain) === undefined) warm++;
console.log("2000 honest runs: " + warm + " " + plain.runs);

const steps: [string, () => Runnable][] = [
  ["the base", () => new Step()],
  ["counts", () => new Counts()],
  ["names", () => new Names()],
  ["chains", () => new Chains()],
  ["zero", () => new Zero()],
  ["a literal", () => literal],
];

const record = new Ledger();
for (const [label, make] of steps) {
  console.log(label + ", once: " + text(once(make())));
  console.log(label + ", through three functions: " + text(throughThree(make())));
  console.log(label + ", compared: " + compare(make()));
  console.log(label + ", kept: " + keep(make(), record));
}
console.log("all kept: " + record.all.map(text).join(" | "));
console.log("as json: " + JSON.stringify(record));

const mixed: Step[] = [new Step(), new Counts(), new Names(), new Zero()];
console.log("a list of steps: " + mixed.map(step => step.run()).map(text).join(" | "));
console.log("the base again: " + text(once(plain)));

function viaSuper(): string {
  class Loud extends Counts {
    run(): number {
      const inherited: number = super.run();
      return inherited * 10;
    }
  }
  const asStep: Step = new Loud();
  return text(asStep.run());
}
console.log("super through two levels: " + viaSuper());
