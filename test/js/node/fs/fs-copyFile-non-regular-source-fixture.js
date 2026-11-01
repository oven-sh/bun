// Runs under Bun and under Node.js, in an empty working directory. Prints one line per copyFile
// call. Each call runs in the three forms: when they agree, the line holds one result.
const fs = require("node:fs");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const { promisify } = require("node:util");

const forms = [
  async (src, dest, mode) => fs.copyFileSync(src, dest, mode),
  promisify(fs.copyFile),
  fs.promises.copyFile,
];

function describe(path) {
  let stats;
  try {
    stats = fs.lstatSync(path);
  } catch {
    return "absent";
  }
  const mode = (stats.mode & 0o7777).toString(8);
  if (stats.isFile()) return `a file of ${stats.size} bytes with mode ${mode}`;
  return stats.isFIFO() ? `a FIFO with mode ${mode}` : stats.isDirectory() ? "a directory" : "not a file";
}

// Each destination is [prepare, dest, mode, the path that the line describes]. `prepare` can return a cleanup.
const existing = () => fs.writeFileSync("file.txt", "old content", { mode: 0o600 });
const destinations = {
  "to a new path": [() => {}, "new.txt", 0, "new.txt"],
  "onto a file": [existing, "file.txt", 0, "file.txt"],
  "onto a file with COPYFILE_EXCL": [existing, "file.txt", fs.constants.COPYFILE_EXCL, "file.txt"],
  "into a missing directory": [() => {}, "missing/new.txt", 0, "missing/new.txt"],
  "onto a directory": [() => fs.mkdirSync("destdir"), "destdir", 0, "destdir"],
  "onto a symlink to a file": [() => (existing(), fs.symlinkSync("file.txt", "link")), "link", 0, "file.txt"],
  "onto a dangling symlink": [() => fs.symlinkSync("target.txt", "link"), "link", 0, "target.txt"],
};

function openFifo(path, mode) {
  execFileSync("mkfifo", ["-m", mode, path]);
  // O_RDWR keeps every other open of the FIFO from blocking.
  return fs.openSync(path, fs.constants.O_RDWR);
}

async function copy(label, src, [prepare, dest, mode, described]) {
  const results = new Set();
  for (const form of forms) {
    // "link" goes first: some Node.js releases do not remove a dangling symlink.
    for (const leftover of ["link", "new.txt", "file.txt", "target.txt", "destdir", "dest.fifo"]) {
      fs.rmSync(leftover, { force: true, recursive: true });
    }
    const cleanup = prepare();
    const result = await form(src, dest, mode).then(
      () => "ok",
      error => error.code,
    );
    results.add(`${result}, ${described} is ${describe(described)}`);
    cleanup?.();
  }
  console.log(`${label}: ${[...results].join(" / ")}`);
}

(async () => {
  const fifo = openFifo("fifo", "640");
  fs.mkdirSync("srcdir");
  fs.writeFileSync("srcdir/file.txt", "x");
  for (const mode of ["666", "640"]) {
    fs.writeFileSync(`empty-${mode}.txt`, "");
    fs.chmodSync(`empty-${mode}.txt`, parseInt(mode, 8));
  }

  // A device or a FIFO, then an empty regular file of the same mode: the results are the same.
  const sources = [
    ["/dev/null", "/dev/null"],
    ["an empty file with mode 666", "empty-666.txt"],
    ["a FIFO", "fifo"],
    ["an empty file with mode 640", "empty-640.txt"],
  ];
  for (const [name, src] of sources) {
    for (const [label, destination] of Object.entries(destinations)) {
      await copy(`${name} ${label}`, src, destination);
    }
  }
  for (const src of ["/dev/zero", "/dev/urandom"]) {
    await copy(`${src} to a new path`, src, destinations["to a new path"]);
  }

  fs.writeSync(fifo, "unread");
  await copy("a FIFO that holds bytes to a new path", "fifo", destinations["to a new path"]);
  const buffer = Buffer.alloc(16);
  console.log(`left in the FIFO: ${buffer.toString("utf8", 0, fs.readSync(fifo, buffer))}`);

  await copy("a directory to a new path", "srcdir", destinations["to a new path"]);

  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen("sock", resolve));
  await copy("a socket to a new path", "sock", destinations["to a new path"]);
  await new Promise(resolve => server.close(resolve));

  if (process.platform === "linux") {
    const ontoFifo = () => {
      const fd = openFifo("dest.fifo", "600");
      return () => fs.closeSync(fd);
    };
    for (const [name, src] of sources) {
      await copy(`${name} onto a FIFO`, src, [ontoFifo, "dest.fifo", 0, "dest.fifo"]);
    }

    const force = fs.constants.COPYFILE_FICLONE_FORCE;
    await copy("/dev/null to a new path with COPYFILE_FICLONE_FORCE", "/dev/null", [
      () => {},
      "new.txt",
      force,
      "new.txt",
    ]);
    await copy("a FIFO onto itself with COPYFILE_FICLONE_FORCE", "fifo", [() => {}, "fifo", force, "fifo"]);
  }

  for (const label of ["onto a file", "onto a file with COPYFILE_EXCL", "into a missing directory"]) {
    await copy(`a directory ${label}`, "srcdir", destinations[label]);
  }
  if (process.platform === "linux") {
    await copy("a directory of size 0 to a new path", "/proc/self", destinations["to a new path"]);
    await copy("a regular file of size 0 to a new path", "/proc/sys/kernel/ostype", destinations["to a new path"]);
  }

  fs.closeSync(fifo);
})();
