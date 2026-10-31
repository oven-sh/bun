// Started by spawnWithStdioFiles (../stdio-fd-slots-helpers.ts) with fds 0, 1 and 2 bound to three
// different files. Runs one spawn per row with the row's options. Each child writes a token to
// every fd below the row's slot count, so the file that holds a token names the fd of this process
// that the child's fd is.
//
// The node:child_process rows use nothing from bun, so node can run this file too.
//
//   parent: <result file> <api> <rows as JSON>
//   child:  --child <row> <slots>
const fs = require("node:fs");
const cp = require("node:child_process");

// What the parent got for a slot: a number or null as it is, otherwise the kind of value.
const show = value =>
  value === null || typeof value === "number" ? value : value === undefined ? "undefined" : value.constructor.name;

const apis = {
  async "Bun.spawn"(args, options) {
    const proc = Bun.spawn({ cmd: [process.execPath, ...args], ...options });
    const exitCode = await proc.exited;
    return { exitCode, stdin: show(proc.stdin), stdout: show(proc.stdout), stderr: show(proc.stderr) };
  },
  "Bun.spawnSync"(args, options) {
    const { exitCode, stdout, stderr } = Bun.spawnSync({ cmd: [process.execPath, ...args], ...options });
    return { exitCode, stdout: show(stdout), stderr: show(stderr) };
  },
  spawn(args, options) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const child = cp.spawn(process.execPath, args, options);
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdio: child.stdio.map(show) }));
    return promise;
  },
  spawnSync(args, options) {
    const { status, error, stdout, stderr } = cp.spawnSync(process.execPath, args, options);
    if (error) throw error;
    return { status, stdout: show(stdout), stderr: show(stderr) };
  },
  execFileSync(args, options) {
    return { returned: show(cp.execFileSync(process.execPath, args, options)) };
  },
  execSync(args, options) {
    const command = [process.execPath, ...args].map(arg => JSON.stringify(arg)).join(" ");
    return { returned: show(cp.execSync(command, options)) };
  },
  fork(args, options) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const child = cp.fork(args[0], args.slice(1), options);
    let message;
    child.on("error", reject);
    child.on("message", received => {
      message = received;
      child.send("exit");
    });
    child.on("close", code => resolve({ code, message, stdio: child.stdio.map(show) }));
    return promise;
  },
};

async function parent(resultFile, api, rowsJSON) {
  // JSON cannot carry these stdio entries, so a row names them.
  const rows = JSON.parse(rowsJSON, (key, value) => {
    if (value === "process.stdin") return process.stdin;
    if (value === "process.stdout") return process.stdout;
    if (value === "process.stderr") return process.stderr;
    const file = typeof value === "string" ? /^Bun\.file\((\d)\)$/.exec(value) : null;
    return file ? Bun.file(Number(file[1])) : value;
  });
  const results = [];
  for (const [row, { slots, options }] of rows.entries()) {
    try {
      results.push(await apis[api]([__filename, "--child", String(row), String(slots)], options));
    } catch (e) {
      results.push({ threw: e.message });
    }
  }
  const isOpen = fd => {
    try {
      fs.fstatSync(fd);
      return true;
    } catch {
      return false;
    }
  };
  // Collect the finished subprocess objects first: their finalizers must not close fd 0, 1 or 2.
  if (typeof Bun !== "undefined") Bun.gc(true);
  fs.writeFileSync(resultFile, JSON.stringify({ results, stillOpen: [0, 1, 2].map(isOpen) }));
}

function child(row, slots) {
  for (let fd = 0; fd < Number(slots); fd++) {
    try {
      fs.writeSync(fd, `row${row}fd${fd};`);
    } catch {
      // An "ignore" slot is closed, or is the null device opened for reading. Its token reaches no file.
    }
  }
  if (process.send) {
    process.once("message", () => process.exit(0));
    process.send("written");
  }
}

if (process.argv[2] === "--child") {
  child(process.argv[3], process.argv[4]);
} else {
  parent(process.argv[2], process.argv[3], process.argv[4]);
}
