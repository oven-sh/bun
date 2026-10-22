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

interface Options {
  retries: number;
  delay: number;
  label: string;
}

const defaults: Options = { retries: 3, delay: 0.5, label: "job" };

function withOptions(change: Partial<Options>): Options {
  return { ...defaults, ...change };
}

function cost(o: Options): number {
  return o.retries * o.delay;
}

function banner(o: Options): string {
  return o.label.toUpperCase() + o.retries;
}

class Job {
  options: Options;
  constructor(change: Partial<Options>) {
    this.options = { ...defaults, ...change };
  }
  cost(): number {
    return this.options.retries * this.options.delay;
  }
  banner(): string {
    return this.options.label.toUpperCase();
  }
}

function later(change: Partial<Options>): () => number {
  const options: Options = { ...defaults, ...change };
  return () => options.retries + options.delay;
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const o = withOptions({ retries: i });
  total += cost(o) + banner(o).length + new Job({ delay: i / 2 }).cost() + later({ label: "x" })();
}
console.log("2000 honest rounds: " + total);

const blank: Partial<Options> = { retries: undefined, label: undefined };

attempt("a result", () => withOptions(blank));
attempt("a result: typeof", () => [typeof withOptions(blank).retries, typeof withOptions(blank).delay, typeof withOptions(blank).label]);
attempt("a parameter: cost", () => cost(withOptions(blank)));
attempt("a parameter: banner", () => banner(withOptions(blank)));
attempt("a field", () => new Job(blank).options);
attempt("a field: cost", () => new Job(blank).cost());
attempt("a field: banner", () => new Job(blank).banner());
attempt("a field: JSON", () => JSON.stringify(new Job(blank)));
attempt("a captured variable", () => later(blank)());
attempt("elements", () => [withOptions({}), withOptions(blank), withOptions({ retries: 1 })].map(o => o.retries + 1));
attempt("elements: a sum", () => {
  const list: Options[] = [withOptions({}), withOptions(blank), withOptions({ retries: 1 })];
  let sum = 0;
  for (const o of list) sum += o.retries;
  return sum;
});
attempt("destructured with a default", () => {
  const { retries = 8, label = "none" } = withOptions(blank);
  return [retries, label];
});
attempt("honest again", () => [cost(withOptions({ retries: 2 })), banner(withOptions({})), new Job({}).cost(), later({})()]);

export {};
