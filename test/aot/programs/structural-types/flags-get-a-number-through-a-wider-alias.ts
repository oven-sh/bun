function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

function put<T>(list: (boolean | T)[], index: number, value: T): void {
  list[index] = value;
}

function countSet(flags: boolean[]): number {
  let count = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i]) count++;
  return count;
}

function countExactlyTrue(flags: boolean[]): number {
  let count = 0;
  for (const flag of flags) if (flag === true) count++;
  return count;
}

function countExactlyFalse(flags: boolean[]): number {
  let count = 0;
  for (const flag of flags) if (flag === false) count++;
  return count;
}

function inverted(flags: boolean[]): boolean[] {
  return flags.map(flag => !flag);
}

function secondOr(flags: boolean[], other: boolean): boolean {
  return flags[1] || other;
}

function secondAnd(flags: boolean[], other: boolean): boolean {
  return flags[1] && other;
}

function secondAsNumber(flags: boolean[]): number {
  return Number(flags[1]) + +flags[1];
}

function secondAsText(flags: boolean[]): string {
  return flags[1] ? "yes" : "no";
}

function secondSwitch(flags: boolean[]): string {
  switch (flags[1]) {
    case true:
      return "true";
    case false:
      return "false";
  }
  return "neither";
}

const visitors: [string, (flags: boolean[]) => void][] = [
  ["an honest true", flags => put(flags, 1, true)],
  ["1", flags => put(flags, 1, 1)],
  ["0", flags => put(flags, 1, 0)],
  ["2", flags => put(flags, 1, 2)],
  ["NaN", flags => put(flags, 1, NaN)],
  ["the text false", flags => put(flags, 1, "false")],
  ["an empty string", flags => put(flags, 1, "")],
  ["undefined", flags => put(flags, 1, undefined)],
  ["null", flags => put(flags, 1, null)],
  ["an object", flags => put(flags, 1, {})],
  ["a Boolean object of false", flags => put(flags, 1, new Boolean(false))],
];

const reads: [string, (flags: boolean[]) => unknown][] = [
  ["typeof", flags => typeof flags[1]],
  ["set", countSet],
  ["exactly true", countExactlyTrue],
  ["exactly false", countExactlyFalse],
  ["inverted", inverted],
  ["|| false", flags => secondOr(flags, false)],
  ["&& true", flags => secondAnd(flags, true)],
  ["as a number", secondAsNumber],
  ["as text", secondAsText],
  ["switch", secondSwitch],
  ["JSON", flags => JSON.stringify(flags)],
  ["indexOf true", flags => [flags.indexOf(true), flags.includes(false)]],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [true, i % 2 === 0, false];
  warm += countSet(honest) + countExactlyTrue(honest) + countExactlyFalse(honest) + inverted(honest).length + (secondOr(honest, false) ? 1 : 0) + (secondAnd(honest, true) ? 1 : 0);
  warm += secondAsNumber(honest) + secondAsText(honest).length + secondSwitch(honest).length;
}
console.log("after 2000 honest arrays", warm);

for (const [name, visit] of visitors) {
  for (const [read, run] of reads) {
    attempt(name + ": " + read, () => {
      const flags = [true, false, false];
      visit(flags);
      return run(flags);
    });
  }
}
attempt("a flag in a field", () => {
  class Switch {
    label = "switch";
    on = false;
    text(): string {
      return this.on ? "on" : "off";
    }
    exactly(): boolean {
      return this.on === true;
    }
  }
  const made = new Switch();
  const wide: { on: boolean | number | string } = made;
  const seen: unknown[] = [made.text()];
  for (const value of [1, 0, "off", "", 2.5]) {
    wide.on = value;
    seen.push(made.text(), made.exactly(), typeof made.on);
  }
  return [seen, made.label];
});
