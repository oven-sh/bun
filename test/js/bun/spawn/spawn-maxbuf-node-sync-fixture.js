// The scenarios of "node:child_process sync spawns" in spawn-maxbuf.test.ts. Bun and Node.js both run this file:
// `<exe> spawn-maxbuf-node-sync-fixture.js [scenario]` prints the result of one scenario, or of all, as JSON.
"use strict";
const { execFile, execFileSync, execSync, spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");

const exe = process.execPath;
const maxBuffer = 1000;
const MiB = 1024 * 1024;
// What the children write to stdout and to stderr.
const fill = { stdout: "o", stderr: "e" };

// The child of a scenario: `out` bytes to stdout, then `err` bytes to stderr. With "stay" it then waits to be killed.
function write(out, err, then) {
  for (const [fd, byte, size] of [
    [1, fill.stdout, Number(out)],
    [2, fill.stderr, Number(err)],
  ]) {
    const chunk = Buffer.alloc(size, byte);
    for (let n = 0; n < size;) n += fs.writeSync(fd, chunk, n);
  }
  if (then === "stay") setTimeout(() => {}, 10_000);
}
const child = (out, err, then = "exit") => [__filename, "write", String(out), String(err), then];

// The length of a stream, if it has the bytes that the child writes there and no other.
const length = (bytes, byte) => {
  if (bytes == null) return null;
  return Buffer.from(bytes).equals(Buffer.alloc(bytes.length, byte)) ? bytes.length : `not all "${byte}"`;
};
const output = (result, error = result.error) => ({
  error: error ? error.code : null,
  message: error ? error.message.replace(error.path, "<file>") : null,
  stdout: length(result.stdout, fill.stdout),
  stderr: length(result.stderr, fill.stderr),
});
// How the child ended is a part of the result only where the scenario decides it: the child stays until it is
// killed, or it exits below the limit.
const ended = (result, error) => ({ ...output(result, error), status: result.status, signal: result.signal });
// execFileSync and execSync throw an error that has the keys of a spawnSync result.
const thrown = call => {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("the call did not throw");
};

const scenarios = {
  "spawnSync kills a child that wrote 600 + 600": () => ended(spawnSync(exe, child(600, 600, "stay"), { maxBuffer })),

  "execFileSync kills a child that wrote 600 + 600": () => {
    const error = thrown(() => execFileSync(exe, child(600, 600, "stay"), { maxBuffer }));
    return ended(error, error);
  },

  "execSync throws ENOBUFS for 600 + 600": () => {
    const error = thrown(() => execSync(`"${exe}" "${__filename}" write 600 600`, { maxBuffer }));
    return output(error, error);
  },

  "500 + 500 is at the limit": () => ended(spawnSync(exe, child(500, 500), { maxBuffer })),

  "500 + 501 is over the limit": () => output(spawnSync(exe, child(500, 501), { maxBuffer })),

  "the default limit is 1 MiB: at it": () => ended(spawnSync(exe, child(MiB - 100, 100))),

  "the default limit is 1 MiB: one byte over": () => output(spawnSync(exe, child(MiB - 100, 101))),

  "killSignal is the signal that kills the child": () =>
    ended(spawnSync(exe, child(600, 600, "stay"), { maxBuffer, killSignal: "SIGKILL" })),

  // exec and execFile count each stream, in Node.js too.
  "execFile counts each stream": () =>
    new Promise(resolve => {
      execFile(exe, child(600, 600), { maxBuffer }, (error, stdout, stderr) =>
        resolve(output({ stdout, stderr }, error)),
      );
    }),

  // The child gives its stdout and stderr to a descendant and exits. The descendant writes when the call has seen
  // that exit. stdout is the descendant's pid, padded. The descendant then stays.
  "a descendant goes over the limit after the child exited": () => {
    // With BUN_FEATURE_FLAG_NO_ORPHANS a Bun child kills its descendants when it exits.
    const env = { ...process.env };
    delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
    const result = spawnSync(exe, [__filename, "hand-over"], { maxBuffer, env });
    // The call returns at the read that passes the limit. It does not wait for the descendant to close the pipes.
    let descendantAlive = false;
    try {
      process.kill(parseInt(String(result.stdout), 10), "SIGKILL");
      descendantAlive = true;
    } catch {}
    return {
      error: result.error ? result.error.code : null,
      stdout: result.stdout.length,
      stderr: length(result.stderr, fill.stderr),
      status: result.status,
      signal: result.signal,
      descendantAlive,
    };
  },
};

function handOver() {
  spawn(exe, [__filename, "write-after", String(process.pid)], {
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  }).unref();
  process.exit(0);
}

function writeAfter(pid) {
  // Signal 0 fails when the process is gone. On POSIX that is when the call has reaped it.
  const cell = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      process.kill(Number(pid), 0);
    } catch {
      break;
    }
    Atomics.wait(cell, 0, 0, 2);
  }
  fs.writeSync(1, String(process.pid).padEnd(600));
  fs.writeSync(2, Buffer.alloc(600, fill.stderr));
  setTimeout(() => {}, 10_000);
}

if (process.platform !== "win32") {
  // A child that writes at once has each pipe over the limit when the call first reads. The call reads one pipe, and
  // the signal reaches the child: the call does not read before it watches the child.
  const atOnce = "printf '%01200d' 0; printf '%05000d' 0 >&2; exec sleep 10";

  scenarios["spawnSync kills a child that writes at once"] = () => {
    const { error, status, signal, stdout, stderr } = spawnSync("/bin/sh", ["-c", atOnce], { maxBuffer });
    const pipesRead = Number(stdout.length > 0) + Number(stderr.length > 0);
    return { error: error ? error.code : null, status, signal, pipesRead };
  };

  // The writer is a descendant of the child, which a kill of the child does not stop. It goes over the limit on
  // stdout. Once a write to stdout fails, the call has closed that pipe, and the descendant writes to stderr. The
  // count only ends the loop in a shell whose printf does not report the failure.
  const late =
    "trap '' PIPE; (head -c 60000 /dev/zero; i=0; " +
    "while [ $i -lt 100000 ] && printf x 2>/dev/null; do i=$((i+1)); done; " +
    "printf '%070000d' 0 >&2) & exec sleep 10";

  scenarios["a pipe is not read after the limit is passed"] = () => {
    const errors = new Set();
    let stderr = 0;
    // A call that reads stderr at the exit of the child gets there first in one run of two, so there are several.
    for (let run = 0; run < 20; run++) {
      const result = spawnSync("/bin/sh", ["-c", late], { maxBuffer });
      errors.add(result.error ? result.error.code : null);
      stderr += result.stderr.length;
    }
    return { error: [...errors], stderr };
  };
}

async function main(scenario) {
  const results = {};
  for (const name of scenario ? [scenario] : Object.keys(scenarios)) results[name] = await scenarios[name]();
  process.stdout.write(JSON.stringify(results));
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "write") write(...rest);
else if (mode === "hand-over") handOver();
else if (mode === "write-after") writeAfter(...rest);
else main(mode);
