interface Plugin {
  name: string;
  setup?(): string;
  teardown?: () => string;
}

const log: string[] = [];

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()) + " [" + log.join() + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join() + "]");
  }
  log.length = 0;
}

function run(p: Plugin): string {
  return (p.setup?.() ?? "no setup") + " / " + (p.teardown?.() ?? "no teardown");
}

function guarded(p: Plugin): string {
  if (p.setup) return p.setup();
  return "skipped";
}

function byTypeof(p: Plugin): string {
  return typeof p.setup === "function" ? p.setup() : typeof p.setup;
}

function byIn(p: Plugin): string {
  return ("setup" in p) + " " + Object.hasOwn(p, "setup") + " " + Object.keys(p).join();
}

class Base {
  name = "class";
  setup(): string {
    return "setup of " + this.name;
  }
}

class WithField {
  name = "field";
  setup?: () => string;
  teardown = (): string => "teardown of " + this.name;
}

class Watching {
  name = "watching";
  get setup(): (() => string) | undefined {
    log.push("get setup");
    return log.length % 2 === 1 ? () => "from the getter" : undefined;
  }
}

const table: [string, Plugin][] = [
  ["absent", { name: "absent" }],
  ["undefined", { name: "undefined", setup: undefined, teardown: undefined }],
  ["own methods", { name: "own", setup() { return "setup of " + this.name; }, teardown: () => "arrow" }],
  ["a method of a class", new Base()],
  ["a declared field never set", new WithField()],
  ["inherited through Object.create", Object.assign(Object.create({ setup: () => "inherited" }), { name: "created" })],
  ["a getter that answers every other time", new Watching()],
];

for (const [label, p] of table) {
  attempt(label + ", optional call", () => run(p));
  attempt(label + ", truthiness", () => guarded(p));
  attempt(label + ", typeof", () => byTypeof(p));
  attempt(label + ", in", () => byIn(p));
}

const honest: Plugin = { name: "honest", setup: () => "ready" };
let length = 0;
for (let i = 0; i < 2000; i++) length += run(honest).length + guarded(honest).length;
console.log("2000 that have it: " + length);
for (const [label, p] of table) attempt("then " + label, () => run(p) + " | " + guarded(p));

const changing: Plugin = { name: "changing" };
const seen: string[] = [];
for (let i = 0; i < 6; i++) {
  seen.push(guarded(changing));
  if (i === 1) changing.setup = () => "added";
  if (i === 3) delete changing.setup;
}
console.log("added and deleted in a loop: " + seen.join());

const plugins: Plugin[] = table.map(row => row[1]);
attempt("all of them", () => plugins.map(p => p.setup?.() ?? "-").join());

const instance = new Base();
const asPlugin: Plugin = instance;
delete asPlugin.setup;
attempt("deleting a method that lives on the prototype", () => run(asPlugin) + " " + instance.setup());
asPlugin.setup = undefined;
attempt("undefined stored over a method of a class", () => run(asPlugin));
attempt("and the class's own type still says it is there", () => instance.setup());

export {};
