import { spawn, spawnSync } from "bun";
import { dlopen, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, libcPathForDlopen, tempDirWithFiles } from "harness";
import { closeSync, readSync } from "node:fs";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe(isatty(0) ? true : undefined);
    expect(process.stdin.on("close", function () {})).toBe(process.stdin);
    expect(process.stdin.once("end", function () {})).toBe(process.stdin);
  });

  const files = {
    echo: path.join(import.meta.dir, "process-stdin-echo.js"),
  };

  test("process.stdin - read", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
      env: {
        ...bunEnv,
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED");
  });

  test("process.stdin - resume", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "resume"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: bunEnv,
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe("RESUMED" + lines.join("\n") + "ENDED");
  });

  test("process.stdin - close(#6713)", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "close-event"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED-CLOSE");
  });

  test("process.stdout", () => {
    expect(process.stdout).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stdout.isTTY).toBe((isatty(1) || undefined) as any);
  });

  test("process.stderr", () => {
    expect(process.stderr).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stderr.isTTY).toBe((isatty(2) || undefined) as any);
  });

  test("process.stdout - write", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    expect(stdout?.toString()).toBe(`hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`);
  });

  test("process.stdout - write a lot (string)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
        TEST_STDIO_STRING: "1",
      },
    });

    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test("process.stdout - write a lot (bytes)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  // O_NONBLOCK is an open-file-description flag: any co-process or thread
  // sharing the description (worker threads, a parent shell, libuv) can flip it
  // on the process-wide fd 1/2. Bun must (a) not flip it from the worker stdio
  // path and (b) not drop output when something else has.
  describe.skipIf(!(isLinux || isMacOS))("stdout/stderr vs O_NONBLOCK on a pipe", () => {
    // fcntl is variadic; Apple's arm64 ABI puts variadic args on the stack, so a
    // fixed-arg dlopen binding gets F_SETFL wrong there. Compile non-variadic
    // wrappers instead (fdutil.c is shared with the spawned children).
    const dir = tempDirWithFiles("stdio-nonblock", {
      "fdutil.c": `
#include <fcntl.h>
int fd_is_nonblock(int fd) { int fl = fcntl(fd, F_GETFL); return fl >= 0 && (fl & O_NONBLOCK) != 0; }
int fd_set_nonblock(int fd) { int fl = fcntl(fd, F_GETFL); return fl < 0 ? fl : fcntl(fd, F_SETFL, fl | O_NONBLOCK); }
`,
    });
    const fdutil = path.join(dir, "fdutil.c");
    const prelude = `
const { cc } = require("bun:ffi");
const { fd_is_nonblock, fd_set_nonblock } = cc({
  source: ${JSON.stringify(fdutil)},
  symbols: {
    fd_is_nonblock: { args: ["int"], returns: "int" },
    fd_set_nonblock: { args: ["int"], returns: "int" },
  },
}).symbols;
const nonblock = fd => fd_is_nonblock(fd) !== 0;
`;

    test("reading process.stdout / process.stderr leaves fd 1/2 blocking", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          prelude +
            `
const before = [nonblock(1), nonblock(2)];
void process.stdout;
void process.stderr;
const after = [nonblock(1), nonblock(2)];
process.stderr.write(JSON.stringify({ before, after }));
`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr)).toEqual({ before: [false, false], after: [false, false] });
      expect(exitCode).toBe(0);
    });

    test("starting a node:worker_threads Worker leaves fd 1/2 blocking", async () => {
      // The worker's stdio rebind must not reify the fd-backed stream
      // (JSC defineOwnProperty on a lazy PropertyCallback would run it).
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          prelude +
            `
const { Worker } = require("node:worker_threads");
const before = [nonblock(1), nonblock(2)];
const w = new Worker("setTimeout(() => {}, 0)", { eval: true });
w.on("online", () => {
  const after = [nonblock(1), nonblock(2)];
  process.stderr.write(JSON.stringify({ before, after }));
  w.on("exit", () => {});
});
`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr)).toEqual({ before: [false, false], after: [false, false] });
      expect(exitCode).toBe(0);
    });

    test("console.log delivers every byte when fd 1 is O_NONBLOCK and the pipe is full", async () => {
      // The open file description can be flipped by anything sharing it; the
      // native console writer must poll for writability on EAGAIN, not discard
      // the unwritten tail.
      // stdout: "pipe" pre-drains into the parent, so use a raw pipe(2) whose
      // read end only this test drains: the child fills it to EAGAIN, signals
      // the byte count on stderr, then console.log()s the markers into the
      // still-full pipe; the parent starts draining only after the signal.
      // pipe(2) is not variadic, so a dlopen binding is ABI-correct everywhere.
      const { pipe } = dlopen(libcPathForDlopen(), {
        pipe: { args: ["ptr"], returns: "int" },
      }).symbols;
      const fds = new Int32Array(2);
      expect(pipe(ptr(fds))).toBe(0);
      const [r, w] = fds;
      let wClosed = false;
      try {
        await using proc = spawn({
          cmd: [
            bunExe(),
            "-e",
            prelude +
              `
const fs = require("node:fs");
fd_set_nonblock(1);
const fill = Buffer.alloc(4096, 120);
let filled = 0;
for (let i = 0; i < 1000; i++) {
  try { filled += fs.writeSync(1, fill); } catch { break; }
}
fs.writeSync(2, String(filled) + "\\n");
for (let i = 0; i < 10; i++) console.log("marker " + i);
`,
          ],
          env: bunEnv,
          stdio: ["ignore", w, "pipe"],
        });
        closeSync(w);
        wClosed = true;
        const reader = proc.stderr.getReader();
        let header = "";
        while (!header.includes("\n")) {
          const { value, done } = await reader.read();
          if (done) break;
          header += Buffer.from(value).toString();
        }
        const nl = header.indexOf("\n");
        const filled = Number(header.slice(0, nl >= 0 ? nl : header.length));
        let stderrRest = nl >= 0 ? header.slice(nl + 1) : "";
        expect(filled).toBeGreaterThan(0);
        const buf = Buffer.alloc(65536);
        let total = Buffer.alloc(0);
        for (;;) {
          const n = readSync(r, buf);
          if (n === 0) break;
          total = Buffer.concat([total, buf.subarray(0, n)]);
        }
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          stderrRest += Buffer.from(value).toString();
        }
        const exitCode = await proc.exited;
        expect({
          stderrRest,
          filledOK: total.subarray(0, filled).equals(Buffer.alloc(filled, 120)),
          payload: total.subarray(filled).toString(),
        }).toEqual({
          stderrRest: "",
          filledOK: true,
          payload: Array.from({ length: 10 }, (_, i) => `marker ${i}\n`).join(""),
        });
        expect(exitCode).toBe(0);
      } finally {
        if (!wClosed) {
          try {
            closeSync(w);
          } catch {}
        }
        try {
          closeSync(r);
        } catch {}
      }
    });
  });
});
