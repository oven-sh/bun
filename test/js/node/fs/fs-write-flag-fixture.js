// Prints what each writeFile and appendFile form does with each `flag` value.
// fs.test.ts runs this file under Node.js and under Bun. The output must be the same.
// Not covered: an fd or a FileHandle with a flag that is not falsy. Node ignores that flag.
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(process.argv[2], "f.txt");
const falsy = [
  ["false", false],
  ["0", 0],
  ["-0", -0],
  ["NaN", NaN],
  ["0n", 0n],
  ["''", ""],
  ["null", null],
  ["undefined", undefined],
];
const notFalsy = [
  ["'w'", "w"],
  ["'a'", "a"],
  ["true", true],
  ["'bogus'", "bogus"],
  ["{}", {}],
  ["[]", []],
];
const withCallback = fn => new Promise((resolve, reject) => fn(err => (err ? reject(err) : resolve())));
const forms = [
  ["fs.writeFileSync", (target, options) => fs.writeFileSync(target, "new", options)],
  ["fs.appendFileSync", (target, options) => fs.appendFileSync(target, "new", options)],
  ["fs.writeFile", (target, options) => withCallback(done => fs.writeFile(target, "new", options, done))],
  ["fs.appendFile", (target, options) => withCallback(done => fs.appendFile(target, "new", options, done))],
  ["fs.promises.writeFile", (target, options) => fs.promises.writeFile(target, "new", options)],
  ["fs.promises.appendFile", (target, options) => fs.promises.appendFile(target, "new", options)],
];
const iterables = [
  ["an array", () => ["n", "e", "w"]],
  [
    "an async generator",
    async function* () {
      yield "new";
    },
  ],
];

// One line for each outcome, with the flag values that give it.
async function print(title, flags, run) {
  const flagsByOutcome = new Map();
  for (const [label, flag] of flags) {
    fs.writeFileSync(file, "old content");
    let outcome;
    try {
      await run(flag);
      outcome = JSON.stringify(fs.readFileSync(file, "utf8"));
    } catch (e) {
      outcome = `${e.code}, the file holds ${JSON.stringify(fs.readFileSync(file, "utf8"))}`;
    }
    flagsByOutcome.set(outcome, [...(flagsByOutcome.get(outcome) || []), label]);
  }
  console.log(title);
  for (const [outcome, labels] of flagsByOutcome) console.log(`  ${labels.join(", ")}: ${outcome}`);
}

(async () => {
  for (const [name, write] of forms) {
    await print(`${name}(path, { flag })`, [...falsy, ...notFalsy], flag => write(file, { flag }));
  }
  for (const [name, write] of forms.slice(0, 4)) {
    await print(`${name}(fd, { flag })`, falsy, async flag => {
      const fd = fs.openSync(file, name.includes("append") ? "a" : "r+");
      try {
        await write(fd, { flag });
      } finally {
        fs.closeSync(fd);
      }
    });
  }
  for (const [name, write] of forms.slice(4)) {
    await print(`${name}(FileHandle, { flag })`, falsy, async flag => {
      const handle = await fs.promises.open(file, name.includes("append") ? "a" : "r+");
      try {
        await write(handle, { flag });
      } finally {
        await handle.close();
      }
    });
  }
  for (const [kind, data] of iterables) {
    await print(`fs.promises.writeFile(path, ${kind}, { flag })`, [...falsy, ...notFalsy], flag =>
      fs.promises.writeFile(file, data(), { flag }),
    );
  }
})();
