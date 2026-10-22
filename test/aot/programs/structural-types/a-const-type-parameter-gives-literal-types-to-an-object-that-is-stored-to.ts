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

function exact<const T>(value: T): T {
  return value;
}

const config = exact({ retries: 3, mode: "fast", nested: { depth: 1 }, list: [1, 2] });
const open: { retries: number; mode: string; nested: { depth: number } } = config;

function retriesName(): string {
  switch (config.retries) {
    case 3:
      return "three";
  }
}

function modeName(): string {
  if (config.mode === "fast") return "fast";
  const never: never = config.mode;
  return "never: " + show(never);
}

function report(title: string): void {
  console.log(title + ": " + JSON.stringify(config));
  attempt("  retries", () => [config.retries, config.retries + 1, config.retries === 3, retriesName()]);
  attempt("  mode", () => [config.mode, config.mode.length, config.mode === "fast", modeName()]);
  attempt("  depth", () => [config.nested.depth, config.nested.depth === 1, config.nested.depth * 2]);
  attempt("  list", () => [config.list[0], config.list[1], config.list.length, config.list.length === 2, config.list[0] === 1]);
}

report("before");
open.retries = 5;
report("retries = 5");
open.mode = "slow";
report("mode = 'slow'");
open.nested.depth = 0.5;
report("depth = 0.5");
open.nested = { depth: 9 };
report("another nested object");

const source = [1, 2];
const listed = exact({ list: source });
source.push(3);
source[0] = 0.5;
attempt("a list that has another name", () => [listed.list, listed.list.length, listed.list[0] + 1]);

const pair = exact([1, "a"]);
attempt("a list literal is a readonly tuple of literals", () => [pair[0], pair[1], pair.length, pair[0] === 1, pair[1] === "a"]);
const asList: readonly (number | string)[] = pair;
attempt("seen as a list", () => [asList.length, asList[5], typeof asList[5]]);

const flags = exact({ on: true, off: false, nothing: null, missing: undefined });
const openFlags: { on: boolean; off: boolean } = flags;
openFlags.on = false;
openFlags.off = true;
attempt("booleans", () => [flags.on, flags.off, flags.on ? "on" : "not on", flags.off ? "off is true" : "off", flags.on === true, flags.nothing, flags.missing]);

const zero = exact({ value: 0 });
const openZero: { value: number } = zero;
openZero.value = -0;
attempt("zero holds minus zero", () => [zero.value, Object.is(zero.value, 0), zero.value === 0, 1 / zero.value]);

export {};
