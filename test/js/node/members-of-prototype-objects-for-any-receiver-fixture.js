// Run with the name of a built-in module, and behind it the names of modules whose prototype objects are passed over. Every accessor
// and every method of every prototype object that the module leads to is entered with receivers that are no instances of its class:
// the prototype object itself, an heir of it, plain objects, an instance of another class, proxies, primitives, undefined and null.
// What it answers or throws, and which keys it leaves on its receiver, is printed by member, the receivers with one outcome on one line.
const [id, ...passedOver] = process.argv.slice(2);
const lines = [];

// Objects that no export is the class of.
const makers = {
  "node:assert": () => [new (require("node:assert").CallTracker)()],
  "node:async_hooks": () => [
    new (require("node:async_hooks").AsyncLocalStorage)(),
    new (require("node:async_hooks").AsyncResource)("resource"),
    require("node:async_hooks").createHook({}),
  ],
  "node:crypto": () => [require("node:crypto").createHash("sha1"), require("node:crypto").createHmac("sha1", "key")],
  "node:diagnostics_channel": () => [
    require("node:diagnostics_channel").channel("channel"),
    require("node:diagnostics_channel").tracingChannel("tracing"),
  ],
  "node:dns": () => [new (require("node:dns").Resolver)(), new (require("node:dns").promises.Resolver)()],
  "node:events": () => [require("node:events").on(new (require("node:events"))(), "event")],
  "node:http": () => {
    const http = require("node:http");
    const response = new http.ServerResponse(new http.IncomingMessage(null));
    return [response, response.socket, new http.Agent(), new http.Server()];
  },
  "node:readline": () => [
    require("node:readline").createInterface({ input: new (require("node:stream").PassThrough)() }),
  ],
  "node:readline/promises": () => [
    new (require("node:readline/promises").Readline)(new (require("node:stream").PassThrough)()),
  ],
  "node:stream": () => {
    const { Readable, Writable, duplexPair } = require("node:stream");
    const readable = new Readable({ read() {} });
    return [readable._readableState, new Writable({ write() {} })._writableState, duplexPair()[0], readable.iterator()];
  },
  "node:test": () => [require("node:test").mock, require("node:test").mock.timers],
  "node:url": () => [require("node:url").parse("http://host/path?query#hash")],
  "node:zlib": () => [require("node:zlib").createGzip(), require("node:zlib").createBrotliCompress()],
  "bun:sqlite": () => {
    const database = new (require("bun:sqlite").Database)(":memory:");
    return [database, database.query("select 1 as one")];
  },
};

// These act on the process or on the machine whatever their receiver is.
const leftOut = new Set(["exit", "reallyExit", "abort", "kill", "_kill", "kRealListen"]);

// What the language and the host have, which no module of the library wrote.
const notOfTheLibrary = new Set([Object.prototype, Function.prototype]);
for (const key of Reflect.ownKeys(globalThis)) {
  const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, key);
  const value = "value" in descriptor ? descriptor.value : undefined;
  if (typeof value === "function" && typeof value.prototype === "object" && value.prototype !== null) {
    for (let level = value.prototype; level !== null; level = Object.getPrototypeOf(level)) notOfTheLibrary.add(level);
  }
}
for (const made of [function* () {}, async function* () {}, async function () {}]) {
  for (let level = made.prototype ?? null; level !== null; level = Object.getPrototypeOf(level)) notOfTheLibrary.add(level);
}
for (const made of [[][Symbol.iterator](), new Map()[Symbol.iterator](), new Set()[Symbol.iterator](), ""[Symbol.iterator]()]) {
  for (let level = Object.getPrototypeOf(made); level !== null; level = Object.getPrototypeOf(level)) notOfTheLibrary.add(level);
}

const textOfKey = key => (typeof key === "symbol" ? `[${key.description}]` : key);

function textOfValue(value, receiver) {
  if (value === receiver && value !== undefined && value !== null) return "the receiver";
  if (value === null || value === undefined || typeof value === "boolean") return String(value);
  if (typeof value === "function") return `function ${value.name}`;
  if (typeof value !== "object") return typeof value;
  if (value instanceof Promise) value.catch(() => {});
  let name;
  try {
    name = Object.getPrototypeOf(value)?.constructor?.name;
  } catch {}
  return `object ${name ?? "without a class"}`;
}

function textOfError(error) {
  if (error === null || typeof error !== "object") return `throws ${textOfValue(error)}`;
  const kind = `throws ${error.name}${error.code === undefined ? "" : ` ${error.code}`}`;
  if (error.syscall !== undefined || error.errno !== undefined) return kind;
  // The engine quotes the text of the library in these.
  const message = String(error.message)
    .split("\n")[0]
    .replace(/ \(evaluating '.*$/, "")
    .replace(/^.* is not a (function|constructor).*$/, "what is called is not a $1");
  return `${kind}: ${message}`;
}

class Other {
  own = 1;
}
const receivers = [
  ["{}", () => ({})],
  ["an object without a prototype", () => Object.create(null)],
  ["an instance of another class", () => new Other()],
  ["a proxy of {}", () => new Proxy({}, {})],
  ["an heir of the prototype object", level => Object.create(level)],
  ["a proxy of such an heir", level => new Proxy(Object.create(level), {})],
  ["the prototype object", level => level],
  ["a number", () => 7],
  ["a string", () => "text"],
  ["undefined", () => undefined],
  ["null", () => null],
];

const objects = receivers.slice(0, 7).map(([name]) => name);
function shortened(names) {
  if (names.length === receivers.length) return ["every receiver"];
  if (!objects.every(name => names.includes(name))) return names;
  return ["every object", ...names.filter(name => !objects.includes(name))];
}

function enter(title, level, body) {
  const outcomes = new Map();
  for (const [name, make] of receivers) {
    const before = new Map();
    for (const key of Reflect.ownKeys(level)) before.set(key, Reflect.getOwnPropertyDescriptor(level, key));
    const receiver = make(level);
    const isObject = typeof receiver === "object" && receiver !== null;
    const keysBefore = new Set(isObject ? Reflect.ownKeys(receiver) : []);
    let outcome;
    try {
      outcome = textOfValue(body(receiver), receiver);
    } catch (error) {
      outcome = textOfError(error);
    }
    if (isObject) {
      const stored = Reflect.ownKeys(receiver).filter(key => !keysBefore.has(key));
      if (stored.length !== 0) outcome += `, stores ${stored.map(textOfKey).join(" ")}`;
    }
    // The prototype object is left as it was found.
    for (const key of Reflect.ownKeys(level)) if (!before.has(key)) delete level[key];
    for (const [key, descriptor] of before) {
      try {
        Object.defineProperty(level, key, descriptor);
      } catch {}
    }
    if (outcomes.has(outcome)) outcomes.get(outcome).push(name);
    else outcomes.set(outcome, [name]);
  }
  lines.push(title);
  for (const [outcome, names] of outcomes) lines.push(`  ${outcome} <- ${shortened(names).join(", ")}`);
}

const levels = new Map();
function addLevelsFrom(level, path) {
  for (let above = 0; level !== null && level !== undefined && !notOfTheLibrary.has(level); above++) {
    if (!levels.has(level)) levels.set(level, above === 0 ? path : `${path}, ${above} above`);
    level = Object.getPrototypeOf(level);
  }
}
const visited = new Set([globalThis, process, Bun]);
function visit(value, path, depth) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || visited.has(value)) return;
  visited.add(value);
  if (typeof value === "function") {
    const prototype = value.prototype;
    if (typeof prototype === "object" && prototype !== null) addLevelsFrom(prototype, `${path}.prototype`);
  } else {
    addLevelsFrom(Object.getPrototypeOf(value), `what is above ${path}`);
  }
  if (depth === 2) return;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "prototype" || key === "constructor" || key.startsWith("_")) continue;
    let member;
    try {
      member = value[key];
    } catch {
      continue;
    }
    visit(member, `${path}.${key}`, depth + 1);
  }
}

process.on("uncaughtException", error => lines.push(`later: ${textOfError(error)}`));
process.on("unhandledRejection", error => lines.push(`later, a rejection: ${textOfError(error)}`));

function visitModule(id) {
  visit(require(id), id, 0);
  (makers[id]?.() ?? []).forEach((made, index) => addLevelsFrom(Object.getPrototypeOf(made), `what is above object ${index}`));
}
passedOver.forEach(visitModule);
for (const level of levels.keys()) notOfTheLibrary.add(level);
levels.clear();
visitModule(id);

for (const [level, path] of levels) {
  for (const key of Reflect.ownKeys(level)) {
    if (key === "constructor" || leftOut.has(typeof key === "symbol" ? key.description : key)) continue;
    const { get, set, value } = Reflect.getOwnPropertyDescriptor(level, key);
    const title = `${path} ${textOfKey(key)}`;
    if (typeof get === "function") enter(`${title}, read`, level, receiver => get.call(receiver));
    if (typeof set === "function") enter(`${title}, stored to`, level, receiver => set.call(receiver, 1));
    if (typeof value === "function") {
      enter(`${title}()`, level, receiver => value.call(receiver));
      enter(`${title}("a", 1)`, level, receiver => value.call(receiver, "a", 1));
    }
  }
}

let turns = 0;
(function turn() {
  if (++turns < 4) return setImmediate(turn);
  process.stdout.write(lines.join("\n") + "\n", () => process.exit(0));
})();
