function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

type Outcome = { value: number; error?: undefined } | { error: string; value?: undefined };
type Loaded = { state: "done"; data: number[] } | { state: "wait"; data?: never };

function read(o: Outcome): number {
  return o.error === undefined ? o.value + 1 : -o.error.length;
}

function readByTruth(o: Outcome): number {
  if (o.error) return -o.error.length;
  return o.value === undefined ? 0 : o.value + 1;
}

function readByValue(o: Outcome): string {
  if (o.value !== undefined) return "value " + o.value.toFixed(1);
  return "error " + o.error.toUpperCase();
}

function count(l: Loaded): number {
  return l.data ? l.data.length : -1;
}

function countByState(l: Loaded): number {
  return l.state === "done" ? l.data.length : -1;
}

attempt("honest", () => [read({ value: 1 }), read({ error: "bad" }), readByTruth({ value: 1 }), readByTruth({ error: "bad" }), readByValue({ value: 1 }), readByValue({ error: "bad" }), count({ state: "done", data: [1] }), count({ state: "wait" }), countByState({ state: "done", data: [1, 2] })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += read(i & 1 ? { value: i } : { error: "e" }) + readByTruth({ value: i }) + readByValue({ value: i }).length + count({ state: "done", data: [i] });
console.log("2000 honest rounds", warm);

attempt("an empty error", () => [read({ error: "" }), readByTruth({ error: "" }), readByValue({ error: "" })]);
attempt("present and undefined", () => [read({ value: 1, error: undefined }), readByValue({ error: "e", value: undefined }), Object.keys({ value: 1, error: undefined })]);
attempt("not a number", () => [read({ value: NaN }), readByTruth({ value: NaN }), readByValue({ value: NaN }), readByTruth({ value: 0 }), readByTruth({ value: -0 })]);
attempt("the error appears through a wider view", () => {
  const o: Outcome = [{ value: 1 } satisfies Outcome][0];
  const open: { error?: string } = o;
  open.error = "late";
  return [read(o), readByTruth(o), readByValue(o)];
});
attempt("the value disappears through a wider view", () => {
  const o: Outcome = [{ value: 1 } satisfies Outcome][0];
  const open: { value?: number } = o;
  delete open.value;
  return read(o);
});
attempt("the value disappears, then a method", () => {
  const o: Outcome = [{ value: 1 } satisfies Outcome][0];
  const open: { value?: number } = o;
  delete open.value;
  return readByValue(o);
});
attempt("an error inherited from a prototype", () => {
  class WithValue {
    value = 1;
  }
  class Odd extends WithValue {
    declare error?: undefined;
  }
  Object.defineProperty(Odd.prototype, "error", { value: "inherited", configurable: true });
  return [read(new Odd()), readByTruth(new Odd())];
});
attempt("data that never should be there", () => {
  const l: Loaded = [{ state: "wait" } satisfies Loaded][0];
  const open: { data?: number[] } = l;
  open.data = [1, 2, 3];
  return [count(l), countByState(l)];
});
attempt("done without data", () => {
  const l: Loaded = [{ state: "done", data: [1] } satisfies Loaded][0];
  const open: { data?: number[] } = l;
  delete open.data;
  return [count(l)];
});
attempt("done without data, by state", () => {
  const l: Loaded = [{ state: "done", data: [1] } satisfies Loaded][0];
  const open: { data?: number[] } = l;
  delete open.data;
  return countByState(l);
});
attempt("honest again", () => [read({ value: 1 }), read({ error: "bad" }), readByValue({ value: 1 }), count({ state: "wait" })]);
