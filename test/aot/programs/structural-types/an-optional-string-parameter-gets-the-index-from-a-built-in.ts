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

const log: string[] = [];

function note(s: string, suffix?: string): void {
  log.push(s + " " + typeof suffix + " " + (suffix === undefined ? "none" : suffix.length));
}
function upper(s: string, suffix?: string): string {
  return suffix === undefined ? s : s + suffix.toUpperCase();
}
function joined(s: string, suffix?: string): string {
  return s + (suffix ?? "");
}
function defaulted(s: string, suffix: string = "-") : string {
  return s + suffix + suffix.length;
}
function keepIf(s: string, suffix?: string): boolean {
  return suffix === undefined || suffix.length > 0;
}

const noteShort: (s: string) => void = note;
const upperShort: (s: string) => string = upper;
const joinedShort: (s: string) => string = joined;
const defaultedShort: (s: string) => string = defaulted;
const keepIfShort: (s: string) => boolean = keepIf;

const words = ["a", "b", "c"];

show("honest note", () => note("x", "yz"));
show("honest upper", () => upper("x", "yz"));
show("honest joined", () => joined("x", "yz"));
show("honest defaulted", () => defaulted("x", "yz"));
show("short call: upper", () => upperShort("x"));
show("short call: defaulted", () => defaultedShort("x"));

show("forEach note", () => words.forEach(noteShort));
show("map upper", () => words.map(upperShort));
show("map joined", () => words.map(joinedShort));
show("map defaulted", () => words.map(defaultedShort));
show("filter keepIf", () => words.filter(keepIfShort));
show("some keepIf", () => words.some(keepIfShort));
show("every keepIf", () => words.every(keepIfShort));
show("find keepIf", () => words.find(keepIfShort));
show("findIndex keepIf", () => words.findIndex(keepIfShort));
show("flatMap joined", () => words.flatMap(joinedShort));
show("Array.from joined", () => Array.from(words, joinedShort));
show("Array.from upper", () => Array.from(words, upperShort));
show("Array.from a set, joined", () => Array.from(new Set(words), joinedShort));
show("set forEach note", () => new Set(words).forEach(noteShort));
show("map forEach note", () => new Map([["k", "v"]]).forEach(noteShort));
show("replace joined", () => "abc".replace("b", joinedShort));
show("replace with a group, joined", () => "abc".replace(/(b)/, joinedShort));
show("replace upper", () => "abc".replace("b", upperShort));
show("replace with a group, upper", () => "abc".replace(/(b)/, upperShort));
show("replaceAll joined", () => "abcb".replaceAll("b", joinedShort));

for (const entry of log) console.log("log " + entry);

const results: string[] = [];
Promise.resolve("p")
  .then(joinedShort)
  .then(value => {
    results.push(value);
    return value;
  })
  .then(defaultedShort)
  .then(value => {
    results.push(value);
    console.log("then " + results.join());
  });
