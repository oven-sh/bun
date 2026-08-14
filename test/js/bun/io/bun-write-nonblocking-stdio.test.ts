// O_NONBLOCK lives on the open file description, so once process.stdout has
// been used (a Worker does that while starting up) fd 1 is non-blocking for
// everything that writes to it, Bun.write(Bun.stdout, file) included; a child
// process inherits the state too. The file-to-file copy behind Bun.write is a
// blocking-style loop on a pool thread. It used to report the EAGAIN such an fd
// produces as the copy's failure instead of waiting for the fd.
//
// Bun.spawn's stdio are socketpairs, so the children run under sh to get real
// pipes on fd 0/1. Each child reports on stderr as JSON lines: {ready: <bytes
// prefilled>} as soon as Bun.write() has been called, then the promise's
// outcome; the test supplies the input or the reader only after "ready".
import { describe, expect, it } from "bun:test";
import { execFileSync } from "child_process";
import fs from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// On Linux the copy is a splice(2)/sendfile(2) loop; the env var sends it down
// the read(2)/write(2) loop that macOS and FreeBSD always use for an fd
// destination, so the Linux lanes cover both.
const loops: [string, Record<string, string>][] = [
  ["kernel copy", {}],
  ["read/write loop", { BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1" }],
];

const copyScript = (setup: string, source: string) => `
  let prefilled = 0;
  ${setup}
  const copy = Bun.write(Bun.stdout, ${source});
  process.stderr.write(JSON.stringify({ ready: prefilled }) + "\\n");
  copy
    .then(n => ({ resolved: n }), e => ({ rejected: e.code + " " + e.syscall }))
    .then(outcome => process.stderr.write(JSON.stringify(outcome) + "\\n"));
`;

// Makes fd 1 non-blocking the way any process.stdout use does, then fills the
// pipe behind it until the kernel refuses more: nothing can be written to it
// until the reader drains it.
const fillStdout = `
  process.stdout.write("");
  const fs = require("fs");
  const zeros = Buffer.alloc(4096);
  for (;;) {
    try {
      prefilled += fs.writeSync(1, zeros);
    } catch (e) {
      if (e.code !== "EAGAIN") throw e;
      break;
    }
  }
`;

const shell = (pipeline: string, script: string, env: Record<string, string> = {}) =>
  ({
    cmd: ["sh", "-c", pipeline],
    env: { ...bunEnv, ...env, BUN: bunExe(), SCRIPT: script },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as const;

// Accumulates a stream. `until` resolves once the text so far satisfies the
// predicate, or the stream ends; `all` once the stream ends. Both resolve with
// the text so far. Concurrent waiters share one in-flight read.
function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let pending: Promise<boolean> | undefined;
  const more = () =>
    (pending ??= reader.read().then(({ value, done }) => {
      pending = undefined;
      if (!done) text += decoder.decode(value, { stream: true });
      return !done;
    }));
  return {
    async until(predicate: (text: string) => boolean) {
      while (!predicate(text)) if (!(await more())) break;
      return text;
    },
    async all() {
      while (await more()) {}
      return text;
    },
  };
}
type Collected = ReturnType<typeof collect>;

const parseLines = (text: string) =>
  text
    .trim()
    .split("\n")
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
const reported = (count: number) => (text: string) => text.endsWith("\n") && parseLines(text).length >= count;

async function ready(stderr: Collected): Promise<number> {
  const text = await stderr.until(reported(1));
  if (!reported(1)(text)) throw new Error("child exited before reporting ready: " + text);
  return parseLines(text)[0].ready;
}

// The source has to be found empty, writer still attached, while the copy is
// under way. Two pieces do that: the second is sent only after the first has
// come back out of the child, so the copy's next syscall met an empty source
// and had to wait. (The broken copy reports EAGAIN instead, possibly before
// even the first piece; the second piece then just lets the pipeline finish.)
async function feedInTwoPieces(stdout: Collected, stderr: Collected, send: (piece: string) => Promise<unknown>) {
  await send("hel");
  await Promise.race([stdout.until(text => text.includes("hel")), stderr.until(reported(2))]);
  await send("lo\n");
}

// Stage 1 turns two lines from sh's stdin (this test) into the two pieces.
const lateStdin = `{ read -r a; printf '%s' "$a"; read -r b; printf '%s\\n' "$b"; } | "$BUN" -e "$SCRIPT" | cat`;
const sendLine = (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => async (piece: string) => {
  proc.stdin.write(piece.trimEnd() + "\n");
  await proc.stdin.flush();
};

async function expectCopied(proc: Bun.Subprocess, stdout: Collected, stderr: Collected) {
  const [out, err, exitCode] = await Promise.all([stdout.all(), stderr.all(), proc.exited]);
  expect({ stdout: out, reports: parseLines(err) }).toEqual({
    stdout: "hello\n",
    reports: [{ ready: 0 }, { resolved: 6 }],
  });
  expect(exitCode).toBe(0);
}

(isWindows ? describe.skip : describe.concurrent)("Bun.write(Bun.stdout, file) with a non-blocking stdio fd", () => {
  it("waits for stdin once process.stdout has made fd 1 non-blocking", async () => {
    // A pipe-to-pipe splice is non-blocking as soon as either pipe is, so it is
    // the empty (blocking) stdin that used to fail the copy here.
    await using proc = Bun.spawn(shell(lateStdin, copyScript(`process.stdout.write("");`, "Bun.stdin")));
    const [stdout, stderr] = [collect(proc.stdout), collect(proc.stderr)];
    await ready(stderr);
    await feedInTwoPieces(stdout, stderr, sendLine(proc));
    await expectCopied(proc, stdout, stderr);
  });

  it("waits for stdin inside a Worker, where fd 1 is non-blocking from the start", async () => {
    const script = `
        const { Worker } = require("node:worker_threads");
        new Worker(
          'const { parentPort } = require("node:worker_threads");' +
            'const copy = Bun.write(Bun.stdout, Bun.stdin);' +
            'parentPort.postMessage({ ready: 0 });' +
            'copy.then(n => ({ resolved: n }), e => ({ rejected: e.code + " " + e.syscall })).then(o => parentPort.postMessage(o));',
          { eval: true },
        ).on("message", report => process.stderr.write(JSON.stringify(report) + "\\n"));
      `;
    await using proc = Bun.spawn(shell(lateStdin, script));
    const [stdout, stderr] = [collect(proc.stdout), collect(proc.stderr)];
    await ready(stderr);
    await feedInTwoPieces(stdout, stderr, sendLine(proc));
    await expectCopied(proc, stdout, stderr);
  }, // Boots a second runtime inside the child; a few seconds under ASAN.
  30_000);

  for (const [name, env] of loops) {
    // The reader of the child's stdout does not start until this test sends it
    // a line over fd 3 (sh's own stdin), so the pipe the child filled up stays
    // full until then; wc then counts prefill + copy.
    const gatedReader = `{ read -r go <&3; exec wc -c; }`;
    const size = 256 * 1024;

    async function expectDrained(proc: Bun.Subprocess<"pipe", "pipe", "pipe">, stderr: Collected, prefilled: number) {
      expect(prefilled).toBeGreaterThan(0);
      proc.stdin.write("go\n");
      await proc.stdin.flush();
      const [stdout, err, exitCode] = await Promise.all([proc.stdout.text(), stderr.all(), proc.exited]);
      expect({ piped: Number(stdout), reports: parseLines(err) }).toEqual({
        piped: prefilled + size,
        reports: [{ ready: prefilled }, { resolved: size }],
      });
      expect(exitCode).toBe(0);
    }

    it(`${name}: a pipe source waits for the reader of a full non-blocking stdout`, async () => {
      await using proc = Bun.spawn(
        shell(
          `exec 3<&0; head -c ${size} /dev/zero | "$BUN" -e "$SCRIPT" | ${gatedReader}`,
          copyScript(fillStdout, "Bun.stdin"),
          env,
        ),
      );
      const stderr = collect(proc.stderr);
      await expectDrained(proc, stderr, await ready(stderr));
    });

    it(`${name}: a regular file source waits for the reader of a full non-blocking stdout`, async () => {
      using dir = tempDir("bun-write-nonblocking-stdout", { "src.bin": Buffer.alloc(size, "S").toString() });
      const source = `Bun.file(${JSON.stringify(join(String(dir), "src.bin"))})`;
      await using proc = Bun.spawn(
        shell(`exec 3<&0; "$BUN" -e "$SCRIPT" | ${gatedReader}`, copyScript(fillStdout, source), env),
      );
      const stderr = collect(proc.stderr);
      await expectDrained(proc, stderr, await ready(stderr));
    });

    it(`${name}: a non-blocking source waits for its writer`, async () => {
      // The child's stdin is a FIFO read end this test opened with O_NONBLOCK;
      // the description is shared, so fd 0 is non-blocking in the child
      // whatever the child does. The writer is attached before the child starts.
      using dir = tempDir("bun-write-nonblocking-stdin", {});
      const fifo = join(String(dir), "fifo");
      execFileSync("mkfifo", [fifo]);
      const readEnd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      const writeEnd = fs.openSync(fifo, "w");
      await using proc = Bun.spawn({
        ...shell(`"$BUN" -e "$SCRIPT" | cat`, copyScript("", "Bun.stdin"), env),
        stdin: readEnd,
      });
      fs.closeSync(readEnd);
      const [stdout, stderr] = [collect(proc.stdout), collect(proc.stderr)];
      try {
        await ready(stderr);
        await feedInTwoPieces(stdout, stderr, async piece => fs.writeSync(writeEnd, piece));
      } finally {
        fs.closeSync(writeEnd);
      }
      await expectCopied(proc, stdout, stderr);
    });
  }
});
