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

function put<T>(list: (string | T)[], index: number, value: T): void {
  list[index] = value;
}

const visitors: [string, (strings: string[]) => void][] = [
  ["a number", strings => put(strings, 1, 5)],
  ["zero", strings => put(strings, 1, 0)],
  ["a fraction", strings => put(strings, 1, 0.5)],
  ["undefined", strings => put(strings, 1, undefined)],
  ["null", strings => put(strings, 1, null)],
  ["true", strings => put(strings, 1, true)],
  ["an array of strings", strings => put(strings, 1, ["x", "y"])],
  ["a String object", strings => put(strings, 1, new String("boxed"))],
  ["a symbol", strings => put(strings, 1, Symbol("s"))],
  ["an object with toString", strings => put(strings, 1, { toString: () => "made" })],
  ["an honest string", strings => put(strings, 1, "honest")],
];

function joined(strings: string[]): string {
  let text = "";
  for (let i = 0; i < strings.length; i++) text += strings[i];
  return text;
}

function totalLength(strings: string[]): number {
  let total = 0;
  for (const string of strings) total += string.length;
  return total;
}

function upper(strings: string[]): string[] {
  return strings.map(string => string.toUpperCase());
}

function secondLetter(strings: string[]): string {
  return strings[1][0];
}

function secondCode(strings: string[]): number {
  return strings[1].charCodeAt(0);
}

function secondIsEmpty(strings: string[]): boolean[] {
  return [strings[1] === "", strings[1] == "", !strings[1], strings[1] === "5", strings[1] == "5"];
}

function secondInATemplate(strings: string[]): string {
  return `<${strings[1]}>`;
}

function secondPlusSecond(strings: string[]): string {
  return strings[1] + strings[1];
}

function compared(strings: string[]): boolean[] {
  return [strings[1] < "b", strings[1] > "b", strings[0] < strings[1]];
}

function asKey(strings: string[]): string[] {
  const record: Record<string, boolean> = {};
  for (const string of strings) record[string] = true;
  return Object.keys(record);
}

const reads: [string, (strings: string[]) => unknown][] = [
  ["typeof", strings => typeof strings[1]],
  ["joined by +", joined],
  ["join", strings => strings.join("|")],
  ["total length", totalLength],
  ["upper case", upper],
  ["first letter", secondLetter],
  ["first code", secondCode],
  ["empty or 5", secondIsEmpty],
  ["template", secondInATemplate],
  ["added to itself", secondPlusSecond],
  ["compared", compared],
  ["as keys", asKey],
  ["sorted", strings => [...strings].sort()],
  ["sorted by localeCompare", strings => [...strings].sort((a, b) => a.localeCompare(b))],
  ["indexOf 5", strings => [strings.indexOf("5"), strings.includes("5")]],
  ["a set", strings => new Set(strings).has("5")],
  ["switch", strings => {
    switch (strings[1]) {
      case "5":
        return "the text 5";
      case "honest":
        return "honest";
      default:
        return "neither";
    }
  }],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = ["a", "b" + i, "c"];
  warm += joined(honest).length + totalLength(honest) + upper(honest).length + secondLetter(honest).length + secondCode(honest) + secondIsEmpty(honest).length;
  warm += secondInATemplate(honest).length + secondPlusSecond(honest).length + compared(honest).length + asKey(honest).length;
}
console.log("after 2000 honest arrays", warm);

for (const [name, visit] of visitors) {
  for (const [read, run] of reads) {
    attempt(name + ": " + read, () => {
      const strings = ["a", "b", "c"];
      visit(strings);
      return run(strings);
    });
  }
}
