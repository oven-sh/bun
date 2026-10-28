// Usage: bun fs-closed-stdio-slot-fixture.js <dir> <family>
//
// For fd 0, then fd 1, then fd 2: closes that fd and runs one family of operations that open and
// close descriptors of their own. The kernel gives a new descriptor the lowest free number, so each
// operation gets the closed number for its first open. The fixture reports which operations left a
// descriptor there.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = process.argv[2];
const family = process.argv[3];

const file = path.join(dir, "data.txt");
const tree = path.join(dir, "tree");
fs.writeFileSync(file, "hello\n");
fs.mkdirSync(path.join(tree, "a", "b"), { recursive: true });
fs.writeFileSync(path.join(tree, "a", "b", "leaf.txt"), "leaf");
// require() and import() open a file only when it is not loaded yet, so each run has its own.
const runs = ["warm-up", "fd 0", "fd 1", "fd 2"];
for (const run of runs) {
  fs.writeFileSync(path.join(dir, run + ".cjs"), "module.exports = 1;");
  fs.writeFileSync(path.join(dir, run + ".json"), "{}");
  fs.writeFileSync(path.join(dir, run + ".mjs"), "export default 1;");
}

// Opened before any number is free, so the result never takes one.
const out = fs.openSync(path.join(dir, "result.json"), "w");

let count = 0;
const fresh = name => path.join(dir, name + "-" + count++);
const callback = fn => new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));
const copyOfTree = () => {
  const copy = fresh("tree");
  fs.cpSync(tree, copy, { recursive: true });
  freeSlot();
  return copy;
};

const onWorkPool = "a stream and a writer, on the work pool";
const families = {
  "node:fs sync operations": {
    "fs.readFileSync": () => fs.readFileSync(file),
    "fs.writeFileSync": () => fs.writeFileSync(fresh("write"), "x"),
    "fs.appendFileSync": () => fs.appendFileSync(fresh("append"), "x"),
    "fs.copyFileSync": () => fs.copyFileSync(file, fresh("copy")),
    "fs.cpSync": () => fs.cpSync(tree, fresh("cp"), { recursive: true }),
    "fs.readdirSync": () => fs.readdirSync(tree),
    "fs.readdirSync recursive": () => fs.readdirSync(tree, { recursive: true }),
    "fs.rmSync recursive": () => fs.rmSync(copyOfTree(), { recursive: true }),
    "fs.realpathSync": () => fs.realpathSync(file),
    "fs.opendirSync": () => {
      const handle = fs.opendirSync(tree);
      handle.readSync();
      handle.closeSync();
    },
    "fs.globSync": () => fs.globSync("**/*.txt", { cwd: tree }),
  },
  "node:fs callback and promise operations": {
    "fs.readFile": () => callback(cb => fs.readFile(file, cb)),
    "fs.writeFile": () => callback(cb => fs.writeFile(fresh("write"), "x", cb)),
    "fs.appendFile": () => callback(cb => fs.appendFile(fresh("append"), "x", cb)),
    "fs.copyFile": () => callback(cb => fs.copyFile(file, fresh("copy"), cb)),
    "fs.readdir": () => callback(cb => fs.readdir(tree, cb)),
    "fs.promises.readFile": () => fs.promises.readFile(file),
    "fs.promises.writeFile": () => fs.promises.writeFile(fresh("write"), "x"),
    "fs.promises.appendFile": () => fs.promises.appendFile(fresh("append"), "x"),
    "fs.promises.copyFile": () => fs.promises.copyFile(file, fresh("copy")),
    "fs.promises.cp": () => fs.promises.cp(tree, fresh("cp"), { recursive: true }),
    "fs.promises.readdir recursive": () => fs.promises.readdir(tree, { recursive: true }),
    "fs.promises.rm recursive": () => fs.promises.rm(copyOfTree(), { recursive: true }),
    "fs.promises.open": async () => {
      const handle = await fs.promises.open(file);
      await handle.read(Buffer.alloc(4), 0, 4, 0);
      await handle.close();
    },
  },
  "the module loader and Bun APIs": {
    "require() of a .cjs file": run => require(path.join(dir, run + ".cjs")),
    "require() of a .json file": run => require(path.join(dir, run + ".json")),
    "import() of a .mjs file": run => import(path.join(dir, run + ".mjs")),
    // The list reads /proc/cpuinfo and /proc/stat when a field of it is read.
    "os.cpus": () => os.cpus()[0].model,
    "Bun.file().text": () => Bun.file(file).text(),
    "Bun.file().bytes": () => Bun.file(file).bytes(),
    "Bun.write(path, Blob)": () => Bun.write(fresh("write"), new Blob(["x"])),
    "Bun.write(path, empty Blob)": () => Bun.write(fresh("write"), new Blob([])),
    "Bun.write(path, Response)": () => Bun.write(fresh("write"), new Response("x")),
    "Bun.write(path, Bun.file())": () => Bun.write(fresh("write"), Bun.file(file)),
    "Bun.Glob.scanSync": () => Array.from(new Bun.Glob("**/*.txt").scanSync(tree)),
    "Bun.Glob.scan": () => Array.fromAsync(new Bun.Glob("**/*.txt").scan(tree)),
    "Bun.build": run => Bun.build({ entrypoints: [path.join(dir, run + ".mjs")] }),
    "Bun.$": () => Bun.$`true`.quiet(),
  },
  // These close their descriptor on the work pool, after the promise settles.
  [onWorkPool]: {
    "Bun.file().stream": async () => {
      for await (const _ of Bun.file(file).stream());
    },
    "Bun.file().writer": async () => {
      const writer = Bun.file(fresh("writer")).writer();
      writer.write("x");
      await writer.end();
    },
  },
};

// The fd that is closed now. None during the warm-up.
let slot = -1;

function slotState() {
  try {
    fs.fstatSync(slot);
  } catch (e) {
    return e.code === "EBADF" ? "closed" : e.code;
  }
  try {
    return "open: " + fs.readlinkSync("/proc/self/fd/" + slot).replace(dir, "<dir>");
  } catch {
    return "open";
  }
}

function freeSlot() {
  if (slot === -1) return;
  try {
    fs.closeSync(slot);
  } catch (e) {
    if (e.code !== "EBADF") throw e;
  }
}

// After each operation, so a fixture that stops early still reports what it saw.
function report(result) {
  const text = JSON.stringify(result);
  fs.ftruncateSync(out, 0);
  fs.writeSync(out, text, 0, text.length, 0);
}

(async () => {
  // An operation can open a descriptor on first use that it does not close when it is done: a
  // debug build reads builtin modules from disk, and the first use can start a thread or an event
  // loop. So every operation runs once before a number is free.
  for (const operation of Object.values(families[family])) await operation(runs[0]);

  const result = {};
  for (slot of [0, 1, 2]) {
    const round = (result["fd " + slot] = { operations: 0, leftOpen: {} });
    for (const [name, operation] of Object.entries(families[family])) {
      // The previous operation can have left a descriptor here. Each operation starts with the slot free.
      freeSlot();
      try {
        await operation("fd " + slot);
      } catch (e) {
        round.leftOpen[name] = "threw " + (e.code ?? e.message);
        report(result);
        continue;
      }
      if (family === onWorkPool) {
        // Nothing signals a close on the work pool, so the fixture polls for it. A descriptor that
        // is still open at the deadline ends the fixture: its close can still be queued, and the
        // next freeSlot() would close the number a second time.
        const deadline = Date.now() + 3_000;
        while (slotState() !== "closed" && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
      }
      const state = slotState();
      if (state !== "closed") round.leftOpen[name] = state;
      round.operations++;
      report(result);
      if (state !== "closed" && family === onWorkPool) process.exit(0);
    }

    // With the slot free again, the next descriptor that the program opens itself gets its number.
    freeSlot();
    fs.readFileSync(file);
    round.nextOpenSync = fs.openSync(file, "r");
    fs.closeSync(round.nextOpenSync);
    round.secondCloseSync = "no error";
    try {
      fs.closeSync(slot);
    } catch (e) {
      round.secondCloseSync = e.code;
    }
    report(result);

    // Takes the number, so the descriptors of the next round get the next number.
    fs.openSync(os.devNull, "r");
  }
  process.exit(0);
})().catch(e => {
  // stderr can be the closed number, so the error goes into the result.
  fs.writeSync(out, "\n" + (e?.stack ?? String(e)));
  process.exit(1);
});
