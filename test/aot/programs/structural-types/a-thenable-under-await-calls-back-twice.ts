function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

class Scripted implements PromiseLike<number> {
  label: string;
  script: (resolve: (value: number) => unknown, reject: (reason: unknown) => unknown) => void;
  constructor(label: string, script: (resolve: (value: number) => unknown, reject: (reason: unknown) => unknown) => void) {
    this.label = label;
    this.script = script;
  }
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, onrejected?: Rejected<B>): PromiseLike<A | B> {
    console.log(this.label + ": then gets " + typeof onfulfilled + " and " + typeof onrejected + ", " + arguments.length + " arguments");
    this.script(
      value => (onfulfilled ? onfulfilled(value) : "no function"),
      reason => (onrejected ? onrejected(reason) : "no function"),
    );
    return new Promise<A | B>(() => {});
  }
}

let continued = 0;

async function wait(thenable: PromiseLike<number>, label: string): Promise<string> {
  try {
    const n: number = await thenable;
    continued++;
    return label + " continued with " + text(n) + ", twice it is " + text(n * 2);
  } catch (error) {
    continued++;
    return label + " caught " + text(error);
  }
}

const scripts: [string, (resolve: (value: number) => unknown, reject: (reason: unknown) => unknown) => void][] = [
  ["once", resolve => {
    console.log("  the callback returns " + text(resolve(1)));
  }],
  ["twice", resolve => {
    resolve(1);
    console.log("  the second call returns " + text(resolve(2)));
  }],
  ["three times", resolve => {
    resolve(1);
    resolve(2);
    resolve(3);
  }],
  ["resolves and then rejects", (resolve, reject) => {
    resolve(1);
    reject("too late");
  }],
  ["rejects and then resolves", (resolve, reject) => {
    reject("first");
    resolve(2);
  }],
  ["rejects twice", (_, reject) => {
    reject("first");
    reject("second");
  }],
  ["once now and once in a later job", resolve => {
    resolve(1);
    queueMicrotask(() => {
      console.log("  the later call returns " + text(resolve(2)));
    });
  }],
  ["only in a later job, twice", resolve => {
    queueMicrotask(() => {
      resolve(10);
      resolve(20);
    });
  }],
];

for (const [label, script] of scripts) {
  continued = 0;
  console.log(await wait(new Scripted(label, script), label));
  await null;
  await null;
  console.log(label + ": the function went on " + continued + " time(s)");
}

console.log(await wait(Promise.resolve(5), "a real promise at the same place"));

export {};
