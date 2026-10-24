function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

interface Plugin {
  name: string;
  setup?: () => string;
  teardown?(): string;
}

interface Named {
  name: string;
}

let evaluated = 0;
function argument(): number {
  evaluated++;
  return evaluated;
}

interface Taking {
  name: string;
  take?: (n: number) => string;
}

function start(plugin: Plugin): string {
  return plugin.name + " " + text(plugin.setup?.());
}

function stop(plugin: Plugin): string {
  return plugin.name + " " + text(plugin.teardown?.());
}

function startOrDefault(plugin: Plugin): string {
  return plugin.setup?.() ?? "no setup";
}

function lengthOfSetup(plugin: Plugin): unknown {
  return plugin.setup?.().length;
}

function checked(plugin: Plugin): string {
  if (plugin.setup) return "truthy, " + plugin.setup();
  return "falsy";
}

function checkedByTypeof(plugin: Plugin): string {
  return typeof plugin.setup === "function" ? plugin.setup() : "typeof " + typeof plugin.setup;
}

function feed(taking: Taking): string {
  return text(taking.take?.(argument()));
}

function forget(named: Named): Plugin {
  return named;
}

class Setup {
  made = true;
}

const odd: [string, () => Named][] = [
  ["a number", () => ({ name: "number", setup: 5, teardown: 6, take: 7 })],
  ["zero", () => ({ name: "zero", setup: 0, teardown: 0, take: 0 })],
  ["a text", () => ({ name: "text", setup: "s", teardown: "t", take: "u" })],
  ["an empty text", () => ({ name: "empty", setup: "", teardown: "", take: "" })],
  ["null", () => ({ name: "null", setup: null, teardown: null, take: null })],
  ["undefined", () => ({ name: "undefined", setup: undefined, teardown: undefined, take: undefined })],
  ["true", () => ({ name: "true", setup: true, teardown: true, take: true })],
  ["an object", () => ({ name: "object", setup: {}, teardown: {}, take: {} })],
  ["a list", () => ({ name: "list", setup: [], teardown: [], take: [] })],
  ["a class", () => ({ name: "class", setup: Setup, teardown: Setup, take: Setup })],
  ["a function that returns a number", () => ({ name: "wrong result", setup: () => 5, teardown: () => 6, take: () => 7 })],
];

const honest: [string, () => Plugin][] = [
  ["with both", () => ({ name: "both", setup: () => "set up", teardown: () => "torn down" })],
  ["with neither", () => ({ name: "neither" })],
];

const uses: [string, (plugin: Plugin) => unknown][] = [
  ["start", start],
  ["stop", stop],
  ["start or default", startOrDefault],
  ["length of the result", lengthOfSetup],
  ["checked for truth", checked],
  ["checked by typeof", checkedByTypeof],
];

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += start(honest[i & 1][1]()).length;
console.log("2000 honest starts: " + warm);

for (const [label, make] of honest) for (const [name, use] of uses) attempt(label + ", " + name, () => use(make()));
for (const [label, make] of odd) {
  for (const [name, use] of uses) attempt(label + ", " + name, () => use(forget(make())));
  const before = evaluated;
  const taking: Taking = make();
  attempt(label + ", called with an argument", () => feed(taking));
  console.log(label + ", the argument was evaluated " + (evaluated - before) + " time(s)");
}
for (const [label, make] of honest) attempt(label + " again, start", () => start(make()));

export {};
