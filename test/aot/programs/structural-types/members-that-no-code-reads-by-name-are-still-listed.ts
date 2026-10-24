interface Named {
  name: string;
}

class Record1 {
  name = "class";
  neverRead = 1;
  alsoNeverRead = "two";
  private quiet = [3];
  static unseen = "static";
}

class Child extends Record1 {
  childOnly = true;
}

function makeLiteral(): Named {
  const made = { silent: 0.5, name: "literal", mute: null, still: { deep: "deep" } };
  return made;
}

function name(n: Named): string {
  return n.name;
}

function listings(n: Named): string[] {
  const walked: string[] = [];
  for (const key in n) walked.push(key);
  return [
    "keys " + Object.keys(n).join(),
    "for-in " + walked.join(),
    "values " + JSON.stringify(Object.values(n)),
    "entries " + JSON.stringify(Object.entries(n)),
    "json " + JSON.stringify(n),
    "spread " + JSON.stringify({ ...n }),
    "assign " + JSON.stringify(Object.assign({}, n)),
    "names " + Object.getOwnPropertyNames(n).join(),
    "own keys " + Reflect.ownKeys(n).map(String).join(),
    "clone " + JSON.stringify(structuredClone(n)),
    "descriptors " + JSON.stringify(Object.getOwnPropertyDescriptors(n)),
  ];
}

function byComputedName(n: Named, key: string): string {
  return key + " in " + (key in n) + " own " + Object.hasOwn(n, key) + " value " + JSON.stringify(Reflect.get(n, key));
}

const things: [string, Named][] = [
  ["a class", new Record1()],
  ["a subclass", new Child()],
  ["a literal", makeLiteral()],
];

for (const [label, thing] of things) {
  console.log(label + ": " + name(thing));
  for (const line of listings(thing)) console.log("  " + line);
}

for (const key of ["neverRead", "alsoNeverRead", "quiet", "childOnly", "silent", "mute", "still", "missing"]) {
  for (const [label, thing] of things) console.log(label + ", " + byComputedName(thing, key));
}

console.log("statics: " + Object.keys(Record1).join() + " " + Object.keys(Child).join() + " " + ("unseen" in Child));

const rest = (({ name: taken, ...others }: Named) => taken + " " + JSON.stringify(others));
for (const [label, thing] of things) console.log(label + ", rest: " + rest(thing));

let count = 0;
for (let i = 0; i < 2000; i++) count += Object.keys(new Record1()).length + JSON.stringify(makeLiteral()).length;
console.log("2000 rounds: " + count);

function onlyStored(): string {
  const o = { kept: 1, stored: 0 };
  o.stored = 5;
  const view: { kept: number } = o;
  return JSON.stringify(view);
}
console.log("a member that is only ever stored: " + onlyStored());

class Logger {
  level = 1;
  history: string[] = [];
  log(line: string): void {
    this.history.push(line);
  }
}
const logger = new Logger();
logger.log("a");
logger.log("b");
console.log("a field that only its own method touches: " + JSON.stringify(logger));

export {};
