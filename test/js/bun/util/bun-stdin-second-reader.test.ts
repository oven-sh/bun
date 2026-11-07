import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// On Windows a pipe inherited as stdin is a synchronous file object, and the
// kernel serialises all I/O on it. A read that waits for input (libuv's
// zero-byte ReadFile for a uv_pipe_t, or the ReadFile behind Bun.stdin.text())
// holds that serialisation lock until data arrives. A second uv_pipe_t over
// fd 0 then blocks the JS thread inside uv_pipe_open. Bun refuses the second
// reader with EBUSY instead, and frees the fd for a new reader as soon as the
// first one is closed.

type Child = ReturnType<typeof spawnReader>;

function spawnReader(script: string) {
  return Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

function feed(proc: Child, line: string) {
  proc.stdin.write(line + "\n");
  proc.stdin.flush();
}

/** The child's stdout, one line at a time. `react` may answer a line on stdin. */
async function readLines(proc: Child, react: (line: string) => void): Promise<string[]> {
  const lines: string[] = [];
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of proc.stdout) {
    rest += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = rest.indexOf("\n")) !== -1) {
      const line = rest.slice(0, nl);
      rest = rest.slice(nl + 1);
      lines.push(line);
      react(line);
    }
  }
  return lines;
}

const helpers = /* js */ `
  const out = s => process.stdout.write(s + "\\n");
  const text = v => (v.done ? "EOF" : Buffer.from(v.value).toString().trim());
  const fail = e => e.code + " " + e.syscall;
  // The first reader's next zero-byte read is queued to the pool thread once
  // the callback that delivered its chunk returns; open the second reader
  // after that, as a later tick would.
  const nextTurn = () => new Promise(resolve => setImmediate(resolve));
`;

test.concurrent.skipIf(!isWindows)(
  "a second Bun.file(0) reader fails with EBUSY while the first waits for input, and opens once the first is cancelled",
  async () => {
    await using proc = spawnReader(`
      ${helpers}
      const r1 = Bun.file(0).stream().getReader();
      out("r1 " + text(await r1.read()));
      const pending = r1.read();
      await nextTurn();
      try {
        Bun.file(0).stream().getReader();
        out("r2 opened");
      } catch (e) {
        out("r2 " + fail(e));
      }
      out("r1 " + text(await pending));
      await r1.cancel();
      const r3 = Bun.file(0).stream().getReader();
      out("r3 opened");
      out("r3 " + text(await r3.read()));
      process.exit(0);
    `);
    feed(proc, "first");
    const [lines, stderr, exitCode] = await Promise.all([
      readLines(proc, line => {
        if (line === "r2 EBUSY open") feed(proc, "second");
        if (line === "r3 opened") feed(proc, "third");
      }),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(lines).toEqual(["r1 first", "r2 EBUSY open", "r1 second", "r3 opened", "r3 third"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isWindows)(
  "Bun.file(0).stream() fails with EBUSY while process.stdin is reading the pipe",
  async () => {
    await using proc = spawnReader(`
      ${helpers}
      let chunks = 0;
      process.stdin.on("data", async d => {
        out("stdin " + d.toString().trim());
        if (++chunks === 2) process.exit(0);
        await nextTurn();
        try {
          Bun.file(0).stream().getReader();
          out("r2 opened");
        } catch (e) {
          out("r2 " + fail(e));
        }
      });
    `);
    feed(proc, "first");
    const [lines, stderr, exitCode] = await Promise.all([
      readLines(proc, line => {
        if (line === "r2 EBUSY open") feed(proc, "second");
      }),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(lines).toEqual(["stdin first", "r2 EBUSY open", "stdin second"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isWindows)(
  "net.connect({ fd: 0 }) fails while a Bun.file(0) reader waits for input",
  async () => {
    await using proc = spawnReader(`
      ${helpers}
      const net = require("node:net");
      const r1 = Bun.file(0).stream().getReader();
      out("r1 " + text(await r1.read()));
      const pending = r1.read();
      await nextTurn();
      const socket = net.connect({ fd: 0 });
      socket.on("data", d => out("net " + d.toString().trim()));
      socket.on("error", () => out("net error"));
      out("r1 " + text(await pending));
      process.exit(0);
    `);
    feed(proc, "first");
    const [lines, stderr, exitCode] = await Promise.all([
      readLines(proc, line => {
        if (line === "net error") feed(proc, "second");
      }),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(lines).toEqual(["r1 first", "net error", "r1 second"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isWindows)(
  "Bun.file(0).stream() fails with EBUSY while net.connect({ fd: 0 }) reads the pipe, and opens once the socket is closed",
  async () => {
    await using proc = spawnReader(`
      ${helpers}
      const net = require("node:net");
      const socket = net.connect({ fd: 0 });
      socket.once("data", async d => {
        out("net " + d.toString().trim());
        await nextTurn();
        try {
          Bun.file(0).stream().getReader();
          out("r2 opened");
        } catch (e) {
          out("r2 " + fail(e));
        }
        socket.once("close", async () => {
          const r3 = Bun.file(0).stream().getReader();
          out("r3 opened");
          out("r3 " + text(await r3.read()));
          process.exit(0);
        });
        socket.destroy();
      });
    `);
    feed(proc, "first");
    const [lines, stderr, exitCode] = await Promise.all([
      readLines(proc, line => {
        if (line === "r3 opened") feed(proc, "third");
      }),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(lines).toEqual(["net first", "r2 EBUSY open", "r3 opened", "r3 third"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isWindows)(
  "process.stdin fails with EBUSY while Bun.stdin.text() waits for input, and a reader opens once text() has finished",
  async () => {
    await using proc = spawnReader(`
      ${helpers}
      const all = Bun.stdin.text();
      await nextTurn();
      try {
        process.stdin.on("data", d => out("stdin " + d.toString().trim()));
        out("stdin attached");
      } catch (e) {
        out("stdin " + fail(e));
      }
      out("text " + JSON.stringify(await all));
      const r3 = Bun.file(0).stream().getReader();
      out("r3 " + text(await r3.read()));
      process.exit(0);
    `);
    const [lines, stderr, exitCode] = await Promise.all([
      readLines(proc, line => {
        if (line === "stdin EBUSY open") {
          feed(proc, "all of it");
          proc.stdin.end();
        }
      }),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(lines).toEqual(["stdin EBUSY open", 'text "all of it\\n"', "r3 EOF"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isWindows)(
  "Bun.stdin.text() rejects with EBUSY while process.stdin is reading the pipe",
  async () => {
    await using proc = spawnReader(`
      ${helpers}
      let chunks = 0;
      process.stdin.on("data", async d => {
        out("stdin " + d.toString().trim());
        if (++chunks === 2) process.exit(0);
        await nextTurn();
        try {
          out("text " + JSON.stringify(await Bun.stdin.text()));
        } catch (e) {
          out("text " + fail(e));
        }
      });
    `);
    feed(proc, "first");
    const [lines, stderr, exitCode] = await Promise.all([
      readLines(proc, line => {
        if (line === "text EBUSY read") feed(proc, "second");
      }),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(lines).toEqual(["stdin first", "text EBUSY read", "stdin second"]);
    expect(exitCode).toBe(0);
  },
);

// The pipe stays claimed while process.stdin is paused: the two handles would
// share one file object, and a resume() while the other reader waits for input
// would block the JS thread again. Cancel or close the first reader instead.
test.concurrent.skipIf(!isWindows)(
  "Bun.file(0).stream() fails with EBUSY while a paused process.stdin still holds the pipe",
  async () => {
    await using proc = spawnReader(`
      ${helpers}
      process.stdin.once("data", async d => {
        out("stdin " + d.toString().trim());
        process.stdin.pause();
        await nextTurn();
        try {
          Bun.file(0).stream().getReader();
          out("r2 opened");
        } catch (e) {
          out("r2 " + fail(e));
        }
        process.exit(0);
      });
    `);
    feed(proc, "first");
    const [lines, stderr, exitCode] = await Promise.all([readLines(proc, () => {}), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(lines).toEqual(["stdin first", "r2 EBUSY open"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("opening a second reader over a piped stdin does not block the event loop", async () => {
  await using proc = spawnReader(`
    ${helpers}
    const r1 = Bun.file(0).stream().getReader();
    out("r1 " + text(await r1.read()));
    r1.read().catch(() => {});
    await nextTurn();
    try {
      Bun.file(0).stream().getReader().read().catch(() => {});
    } catch {}
    out("alive");
    process.exit(0);
  `);
  feed(proc, "first");
  const [lines, stderr, exitCode] = await Promise.all([readLines(proc, () => {}), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(lines).toEqual(["r1 first", "alive"]);
  expect(exitCode).toBe(0);
});
