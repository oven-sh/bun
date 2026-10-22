export {};

const seen: string[] = [];

type Executor = (resolve: (value: number) => void, reject: (reason: unknown) => void) => void;

function Traced(Base: new (executor: Executor) => Promise<number>) {
  return class extends Base {
    label = "traced";
    constructor(executor: Executor) {
      super(executor);
      seen.push("constructed");
    }
  };
}

const Made = Traced(Promise<number>);
const made = new Made(resolve => resolve(5));
console.log("label " + made.label + " keys " + Object.keys(made).join(" ") + " instance " + (made instanceof Promise));
console.log("awaited " + (await made));
const chained = made.then(n => n + 1);
console.log("chained is of the class: " + (chained instanceof Made) + " value " + (await chained));
console.log("constructed " + seen.length + " times");
