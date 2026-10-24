function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Counter {
  (step: number): number;
  count: number;
  label: string;
  history: number[];
  reset(): void;
}

function makeCounter(label: string): Counter {
  const counter: Counter = Object.assign(
    (step: number): number => {
      counter.count += step;
      counter.history.push(step);
      return counter.count;
    },
    {
      count: 0,
      label,
      history: [],
      reset(): void {
        counter.count = 0;
      },
    },
  );
  return counter;
}

function callIt(f: (step: number) => number, step: number): number {
  return f(step);
}
function countOf(o: { count: number }): number {
  return o.count;
}
function labelOf(o: { label: string }): string {
  return o.label;
}
function bump(o: { count: number }): void {
  o.count += 100;
}

const counter = makeCounter("c");
show("typeof", () => typeof counter);
show("call", () => counter(2));
show("call again", () => counter(3));
show("count", () => counter.count);
show("label", () => counter.label);
show("history", () => counter.history);
show("as a plain function", () => callIt(counter, 1));
show("as an object with a count", () => countOf(counter));
show("as an object with a label", () => labelOf(counter));
show("a store as an object with a count", () => bump(counter));
show("count", () => counter.count);
show("reset", () => counter.reset());
show("count", () => counter.count);
show("keys", () => Object.keys(counter).join());
show("JSON", () => JSON.stringify(counter));
show("JSON inside an object", () => JSON.stringify({ counter }));
show("name", () => counter.name);
show("length", () => counter.length);
show("instanceof Function", () => counter instanceof Function);
show("spread keeps the members", () => JSON.stringify({ ...counter }));
show("spread is not callable", () => typeof { ...counter });
show("call()", () => counter.call(undefined, 5));
show("apply()", () => counter.apply(undefined, [5]));
show("bind()()", () => counter.bind(undefined, 5)());
show("bound has no count", () => "count" in counter.bind(undefined));
show("map", () => [1, 2].map(counter));

const plainObject = { count: 1, label: "plain" };
let sum = 0;
for (let i = 0; i < 2000; i++) sum += countOf(plainObject);
show("2000 plain objects", () => sum);
show("then the function", () => countOf(counter));
sum = 0;
const plainFunction = (step: number): number => step * 2;
for (let i = 0; i < 2000; i++) sum += callIt(plainFunction, 1);
show("2000 plain functions", () => sum);
show("then the hybrid", () => callIt(counter, 1));

const two = [makeCounter("a"), makeCounter("b")];
two[0](1);
two[1](10);
show("two counters keep apart", () => two.map(c => c.label + c.count).join());
