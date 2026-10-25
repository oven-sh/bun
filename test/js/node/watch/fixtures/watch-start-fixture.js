// Run in a scratch cwd: `<runtime> watch-start-fixture.js '<rows as JSON>'`. The tests run it under
// Bun and under Node. For each row it starts one watcher, writes the row's files, and prints how
// the start ended: the error, or the name of the first of those files the watcher reported.
const fs = require("node:fs");
const { basename } = require("node:path");
const { getSystemErrorName } = require("node:util");

const typeName = value => (typeof value === "object" && value !== null ? value.constructor.name : typeof value);

// A throw from the call and a rejection from the first next() both reject this promise.
async function firstEvent({ api, path, options }, files) {
  const names = new Set(files.map(file => basename(file)));
  if (api === "fs.promises.watch") {
    for await (const { filename } of fs.promises.watch(path, options)) {
      if (names.has(String(filename))) return String(filename);
    }
    return;
  }
  const { promise, resolve, reject } = Promise.withResolvers();
  if (api === "fs.watchFile") {
    // A poll reports no name. The inode says which of the files it is, and 0 that there is none.
    fs.watchFile(path, { interval: 20 }, current => {
      const file = files.find(file => fs.statSync(file, { throwIfNoEntry: false })?.ino === current.ino);
      if (file !== undefined) resolve(basename(file));
      else if (current.ino === 0) resolve("(no such file)");
    });
    try {
      return await promise;
    } finally {
      fs.unwatchFile(path);
    }
  }
  const watcher = fs.watch(path, options, (eventType, filename) => {
    if (names.has(String(filename))) resolve(String(filename));
  });
  watcher.once("error", reject);
  try {
    return await promise;
  } finally {
    watcher.close();
  }
}

async function main() {
  for (const row of JSON.parse(process.argv[2])) {
    if (row.path.buffer !== undefined) row.path = Buffer.from(row.path.buffer);
    else if (row.path.url !== undefined) row.path = new URL(row.path.url);
    if (row.renameCwd) fs.renameSync(process.cwd(), process.cwd() + row.renameCwd);
    // A watcher on the wrong directory reports the first file, one on the right directory the last.
    const files = row.poke ?? ["poke.txt"];
    let count = 0;
    const poke = () => {
      for (const file of files) fs.writeFileSync(file, String(count++));
    };
    // Only a live watcher waits on this: it can miss a write made before it is ready.
    const poking = setInterval(poke, 20);
    let outcome;
    try {
      const started = firstEvent(row, files);
      poke();
      outcome = { event: await started };
    } catch (e) {
      outcome = {
        name: e.name,
        code: e.code,
        errno: typeof e.errno === "number" ? getSystemErrorName(e.errno) : e.errno,
        syscall: e.syscall,
        filename: [typeName(e.filename), String(e.filename)],
        ...(Object.hasOwn(e, "path") && { path: [typeName(e.path), String(e.path)] }),
        message: e.message,
      };
    } finally {
      clearInterval(poking);
    }
    console.log(JSON.stringify(outcome));
  }
}

main();
