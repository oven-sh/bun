// Prints one row for each check of what an interface does to the stream it reads from.
// readline.node.test.ts expects the same rows from Bun and from Node.js v26.7.0 or later.
const fs = require("node:fs");
const readline = require("node:readline");
const readlinePromises = require("node:readline/promises");
const repl = require("node:repl");
const { PassThrough } = require("node:stream");

const historyKeys = ["size", "history", "removeHistoryDuplicates", "filePath", "onHistoryFileLoaded"];
const rows = [];
const row = (name, value) => rows.push(`${name}: ${value}`);
const attempt = fn => {
  try {
    return fn();
  } catch (error) {
    return `threw ${error.code ?? error.name}`;
  }
};
const ownHistoryKeys = stream => historyKeys.filter(key => Object.hasOwn(stream, key)).join() || "none";
const historyOf = rl => `historySize ${rl.historySize}, history ${JSON.stringify(rl.history)}`;

(async () => {
  const entryPoints = {
    "readline.createInterface({ input })": input => readline.createInterface({ input }),
    "readline.createInterface({ input, output, terminal: true })": input =>
      readline.createInterface({ input, output: new PassThrough(), terminal: true }),
    "new readline.Interface({ input })": input => new readline.Interface({ input }),
    "readline/promises createInterface({ input })": input => readlinePromises.createInterface({ input }),
    "repl.start({ input, output })": input => repl.start({ input, output: new PassThrough() }),
    "repl.start({ input, output, terminal: true })": input =>
      repl.start({ input, output: new PassThrough(), terminal: true }),
  };
  for (const [name, open] of Object.entries(entryPoints)) {
    const input = new PassThrough();
    open(input).close();
    row(`history options on the stream after ${name}`, ownHistoryKeys(input));
  }
  readline.createInterface({ input: process.stdin }).close();
  row(
    "history options on process.stdin after readline.createInterface({ input: process.stdin })",
    ownHistoryKeys(process.stdin),
  );
  {
    const handle = await fs.promises.open(__filename);
    const lines = handle.readLines();
    for await (const _ of lines);
    row("history options on the stream after FileHandle.readLines()", ownHistoryKeys(lines.input));
  }

  {
    const input = new PassThrough();
    input.size = "mine";
    readline.createInterface({ input }).close();
    row("own size of the stream after createInterface({ input })", input.size);
  }
  {
    const read = [];
    const input = new PassThrough();
    for (const key of historyKeys) Object.defineProperty(input, key, { get: () => void read.push(key) });
    row(
      "history options that createInterface({ input }) reads from a stream with a getter for each",
      attempt(() => (readline.createInterface({ input }).close(), read.join() || "none")),
    );
  }
  row(
    "createInterface({ input, terminal: false }) on a stream that is not extensible",
    attempt(() => {
      readline.createInterface({ input: Object.preventExtensions(new PassThrough()), terminal: false }).close();
      return "made";
    }),
  );

  {
    const input = new PassThrough();
    const history = ["x"];
    const first = readline.createInterface({ input, historySize: 3, history });
    row("the history of the interface is the array that was given", first.history === history);
    first.close();
    const later = readline.createInterface(input);
    row("createInterface(input) after createInterface({ input, historySize: 3, history: ['x'] })", historyOf(later));
    later.close();
  }
  {
    const input = new PassThrough();
    const output = new PassThrough();
    readline.createInterface({ input, output, terminal: true, historySize: 3 }).close();
    const later = readline.createInterface(input, output, undefined, true);
    row(
      "createInterface(input, output, undefined, true) after createInterface({ input, output, terminal: true, historySize: 3 })",
      historyOf(later),
    );
    later.close();
  }
  {
    const input = new PassThrough();
    row(
      "createInterface({ input, historySize: -1 })",
      attempt(() => readline.createInterface({ input, historySize: -1 })),
    );
    row(
      "createInterface(input) after that",
      attempt(() => {
        const later = readline.createInterface(input);
        later.close();
        return historyOf(later);
      }),
    );
  }

  const givenToSetupHistoryManager = open => {
    let given;
    class Interface extends readline.Interface {
      setupHistoryManager(options) {
        given = options;
        super.setupHistoryManager(options);
      }
    }
    const input = new PassThrough();
    open(Interface, input).close();
    if (given === input) return "the stream";
    const prototype = Object.getPrototypeOf(given) === null ? "a null-prototype object" : "an object";
    return `${prototype} with ${Object.keys(given).join()}`;
  };
  row(
    "setupHistoryManager receives from new Interface({ input })",
    givenToSetupHistoryManager((Interface, input) => new Interface({ input })),
  );
  row(
    "setupHistoryManager receives from new Interface(input)",
    givenToSetupHistoryManager((Interface, input) => new Interface(input)),
  );

  console.log(rows.join("\n"));
})().catch(error => {
  console.log(rows.join("\n"));
  console.log("FAILED", error);
  process.exitCode = 1;
});
