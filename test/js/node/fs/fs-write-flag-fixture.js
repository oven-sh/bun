// Prints what each writeFile and appendFile form does with each `flag` value, and each readFile form for an fd.
// fs.test.ts runs this file under Node.js and under Bun. The output must be the same.
// Not covered: the read forms with a path, where Bun and Node differ for a falsy flag.
const fs = require("node:fs");
const path = require("node:path");

const [directory, target] = process.argv.slice(2);
const file = path.join(directory, "f.txt");
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
const everyFlag = [...falsy, ...notFalsy];
// Bun 1.3 took the last two for an fd, and Bun 1.4.0 did not.
const descriptorFlags = [...everyFlag, ["'W'", "W"], ["new String('w')", new String("w")]];
// Left out where a sync fast path reads: Node v26.3.0 aborts the process on -0, and Bun takes '' as no flag.
const fastPathReadFlags = descriptorFlags.filter(([label]) => label !== "-0" && label !== "''");
const withCallback = fn => new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));
const forms = [
  ["fs.writeFileSync", (target, options) => fs.writeFileSync(target, "new", options)],
  ["fs.appendFileSync", (target, options) => fs.appendFileSync(target, "new", options)],
  ["fs.writeFile", (target, options) => withCallback(done => fs.writeFile(target, "new", options, done))],
  ["fs.appendFile", (target, options) => withCallback(done => fs.appendFile(target, "new", options, done))],
  ["fs.promises.writeFile", (target, options) => fs.promises.writeFile(target, "new", options)],
  ["fs.promises.appendFile", (target, options) => fs.promises.appendFile(target, "new", options)],
];
const readForms = [
  ["fs.readFileSync", (fd, options) => fs.readFileSync(fd, options)],
  ["fs.readFile", (fd, options) => withCallback(done => fs.readFile(fd, options, done))],
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
const openFlag = name => (name.includes("append") ? "a" : "r+");
async function withFd(name, run) {
  const fd = fs.openSync(file, openFlag(name));
  try {
    return await run(fd);
  } finally {
    fs.closeSync(fd);
  }
}
async function withFileHandle(name, run) {
  const handle = await fs.promises.open(file, openFlag(name));
  try {
    return await run(handle);
  } finally {
    await handle.close();
  }
}

// One line for each outcome, with the flag values that give it. A read also prints what it returned.
async function print(title, flags, run) {
  const flagsByOutcome = new Map();
  for (const [label, flag] of flags) {
    fs.writeFileSync(file, "old content");
    let outcome;
    try {
      const returned = await run(flag);
      outcome = JSON.stringify(fs.readFileSync(file, "utf8"));
      if (returned !== undefined) outcome += `, returned ${JSON.stringify(String(returned))}`;
    } catch (e) {
      outcome = `${e.code}, the file holds ${JSON.stringify(fs.readFileSync(file, "utf8"))}`;
    }
    flagsByOutcome.set(outcome, [...(flagsByOutcome.get(outcome) || []), label]);
  }
  console.log(title);
  for (const [outcome, labels] of flagsByOutcome) console.log(`  ${labels.join(", ")}: ${outcome}`);
}

const targets = {
  async path() {
    for (const [name, write] of forms) {
      await print(`${name}(path, { flag })`, everyFlag, flag => write(file, { flag }));
    }
    for (const [kind, data] of iterables) {
      await print(`fs.promises.writeFile(path, ${kind}, { flag })`, everyFlag, flag =>
        fs.promises.writeFile(file, data(), { flag }),
      );
    }
  },
  // Node opens nothing for an fd or a FileHandle, so it takes every flag there.
  async descriptor() {
    for (const [name, write] of forms.slice(0, 4)) {
      await print(`${name}(fd, { flag })`, descriptorFlags, flag => withFd(name, fd => write(fd, { flag })));
    }
    for (const [name, write] of forms.slice(4)) {
      await print(`${name}(FileHandle, { flag })`, descriptorFlags, flag =>
        withFileHandle(name, handle => write(handle, { flag })),
      );
    }
    for (const [name, read] of readForms) {
      await print(`${name}(fd, { flag })`, descriptorFlags, flag => withFd(name, fd => read(fd, { flag })));
    }
    await print("fs.promises.readFile(FileHandle, { flag })", descriptorFlags, flag =>
      withFileHandle("read", handle => fs.promises.readFile(handle, { flag })),
    );
    await print("FileHandle.readFile({ flag })", descriptorFlags, flag =>
      withFileHandle("read", handle => handle.readFile({ flag })),
    );
    // The exception: the sync UTF-8 fast paths convert the flag for every target. They take string data and an
    // encoding of exactly 'utf8' or 'utf-8'. appendFileSync sets the flag of an fd to 'a' first.
    for (const encoding of ["utf8", "utf-8", "UTF8"]) {
      for (const [name, write] of forms.slice(0, 2)) {
        await print(`${name}(fd, string, { encoding: '${encoding}', flag })`, descriptorFlags, flag =>
          withFd(name, fd => write(fd, { encoding, flag })),
        );
      }
      await print(`fs.readFileSync(fd, { encoding: '${encoding}', flag })`, fastPathReadFlags, flag =>
        withFd("read", fd => fs.readFileSync(fd, { encoding, flag })),
      );
    }
    await print("fs.writeFileSync(fd, Buffer, { encoding: 'utf8', flag })", descriptorFlags, flag =>
      withFd("write", fd => fs.writeFileSync(fd, Buffer.from("new"), { encoding: "utf8", flag })),
    );
    await print("fs.writeFileSync(fd, String object, { encoding: 'utf8', flag })", descriptorFlags, flag =>
      withFd("write", fd => fs.writeFileSync(fd, new String("new"), { encoding: "utf8", flag })),
    );
    await print("fs.writeFile(fd, string, { encoding: 'utf8', flag })", descriptorFlags, flag =>
      withFd("write", fd => withCallback(done => fs.writeFile(fd, "new", { encoding: "utf8", flag }, done))),
    );
  },
};
targets[target]();
