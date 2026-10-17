import type { FileSink } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { closeSync, openSync } from "node:fs";

// On POSIX the builtin `cat` is only used with this flag set (see
// `Kind::DISABLED_ON_POSIX`); without it `cat` is the system binary. On Windows
// the builtin is the default and the flag does nothing.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

// bun as a command of a script. Forward slashes, so the path needs no escaping
// inside a script on Windows.
const bun = `"${bunExe().replaceAll("\\", "/")}"`;
// A command that runs a subprocess and prints nothing.
const subprocess = `${bun} -e 0`;
// A subprocess that ends once the test answers its request to RELEASE_URL.
const gate = `${bun} -e "await (await fetch(process.env.RELEASE_URL)).text()"`;

// The cases of this file run one after the other. Each one starts one to three
// bun processes, and a debug build that starts several of those at the same
// time takes a single case close to the default timeout.

// How the script is run:
// - "captured": `Bun.$` with `.quiet()`. A command that finishes runs the rest
//   of the script synchronously, from inside the callback that finished it.
// - "inherited": `Bun.$` writing to the child's stdout through the event loop.
// - "exec": `bun exec`, which is how package.json scripts run the shell on
//   Windows: its own event loop, and output is never captured.
type Mode = "captured" | "inherited" | "exec";

// Code for a child bun that runs `script` and prints the script's stdout
// followed by an `exit=<code>` trailer. A hang or a crash in the child shows up
// as a missing trailer. (Both go through process.stdout: console.log takes a
// separate path to fd 1 and can overtake a large pending process.stdout.write.)
// With `gated`, the script only starts once a fetch of RELEASE_URL returns.
function childCode(script: string, quiet: boolean, gated = false): string {
  const wait = gated ? `await (await fetch(process.env.RELEASE_URL)).text(); ` : "";
  const run = `Bun.$\`\${{ raw: ${JSON.stringify(script)} }}\`.nothrow()`;
  const trailer = `process.stdout.write("exit=" + r.exitCode + "\\n");`;
  return quiet
    ? `${wait}const r = await ${run}.quiet(); process.stdout.write(r.stdout); ${trailer}`
    : `${wait}const r = await ${run}; ${trailer}`;
}

type Stdin =
  // Written to a pipe that is closed right away, so stdin reaches EOF.
  | { input: string }
  // A directory or /dev/null. Every `cat` reading stdin fails: on POSIX its
  // reader cannot start, because the event loop cannot poll the fd, and on
  // Windows the read fails.
  | { unpollable: string };

function spawnChild(script: string, stdin: Stdin, mode: Mode) {
  const cmd = mode === "exec" ? [bunExe(), "exec", script] : [bunExe(), "-e", childCode(script, mode === "captured")];
  if ("unpollable" in stdin) {
    const fd = openSync(stdin.unpollable, "r");
    try {
      return Bun.spawn({ cmd, env: builtinEnv, stdin: fd, stdout: "pipe", stderr: "pipe" });
    } finally {
      closeSync(fd);
    }
  }
  const proc = Bun.spawn({ cmd, env: builtinEnv, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(stdin.input);
  proc.stdin.end();
  return proc;
}

// The result always ends with the `exit=<code>` trailer: `bun exec` has none,
// so there it is made from the exit code of the process.
async function runScript(script: string, stdin: Stdin, mode: Mode = "captured") {
  await using proc = spawnChild(script, stdin, mode);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (mode === "exec") return { stdout: `${stdout}exit=${exitCode}\n`, stderr, exitCode: 0 };
  return { stdout, stderr, exitCode };
}

// Runs `script` (captured output) in a child whose stdin `prepare` has finished
// with before the script starts: the child blocks on a fetch until then. The
// first wakeup of the script's stdin reader therefore sees everything `prepare`
// did at once, for example the data together with the hang-up. `wrap` turns
// the command line of the child into the one to spawn.
async function runScriptOnPreparedStdin(
  script: string,
  prepare: (stdin: FileSink) => unknown,
  wrap: (cmd: string[]) => string[] = cmd => cmd,
) {
  const pinged = Promise.withResolvers<(response: Response) => void>();
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Promise<Response>(release => pinged.resolve(release)),
  });
  await using proc = Bun.spawn({
    cmd: wrap([bunExe(), "-e", childCode(script, true, true)]),
    env: { ...builtinEnv, RELEASE_URL: server.url.href },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitedEarly = proc.exited.then(code => {
    throw new Error(`the child exited with code ${code} before it asked to start the script`);
  });
  const release = await Promise.race([pinged.promise, exitedEarly]);
  await prepare(proc.stdin);
  release(new Response());
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Runs `script` (captured output) with bun's stdin made by a python3 snippet
// before bun exists. The snippet leaves the read end as fd 0 and gets the
// number of bytes to queue as its first argument.
async function runScriptOnStdinFromPython(makeStdin: string, queued: number, script: string) {
  const python = `import os, sys\n${makeStdin}\nos.execv(sys.argv[2], sys.argv[2:])\n`;
  await using proc = Bun.spawn({
    cmd: ["python3", "-c", python, String(queued), bunExe(), "-e", childCode(script, true)],
    env: builtinEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A pipe that holds `queued` bytes (enlarged with F_SETPIPE_SZ so that they
// fit) and whose writer is closed.
const hungUpPipe = `
import fcntl
r, w = os.pipe()
fcntl.fcntl(w, 1031, 1 << 20)
os.write(w, b"x" * int(sys.argv[1]))
os.close(w)
os.dup2(r, 0)
`;

// A socket that holds `queued` bytes and whose peer closed with data of ours
// still unread: the kernel hands over the bytes, fails one read with
// ECONNRESET, and reports EOF after that.
const resetSocket = `
import socket
ours, peer = socket.socketpair()
peer.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1 << 20)
ours.send(b"unread")
peer.sendall(b"x" * int(sys.argv[1]))
peer.close()
os.dup2(ours.fileno(), 0)
`;

// PIPE_READ_BUFFER_SIZE (src/io/pipe_read_scratch.rs): what one read of the
// POSIX reader takes at most.
const readSize = 256 * 1024;

// Every `cat` reading the script's stdin (or a pipeline stage's stdin)
// registers on the single IOReader owned by that fd. Once the first `cat` has
// consumed a read (EOF or error), a later `cat` on the same fd must be the only
// listener notified by the read that serves it: on POSIX a new read of the fd,
// on Windows (where the reader closes the fd at EOF) the EOF already reached.
describe("cat (builtin) sharing one stdin reader", () => {
  describe("after the first cat reached EOF", () => {
    const scripts: [script: string, stdout: string][] = [
      ["cat; echo ---; cat", "hi\n---\n"],
      ["cat && echo --- && cat", "hi\n---\n"],
      // The second restart starts from a reader that was already restarted once.
      ["cat; cat; cat", "hi\n"],
      // On Windows every cat after the first finishes on the spot, from inside
      // the previous cat's completion. The debug build asserts (Yield.rs) if
      // those completions nest instead of following each other on the same
      // trampoline, which takes four or more cats in a row to show.
      ["cat; cat; cat; cat; cat; cat; echo ---", "hi\n---\n"],
      // The subshell / if node is allocated before the second cat, so the second
      // cat does not reuse the first cat's node id: a listener entry left over
      // from the first cat would be dispatched to a node that is not a cat.
      ["cat; (echo ---; cat)", "hi\n---\n"],
      ["cat; if true; then echo ---; cat; fi", "hi\n---\n"],
    ];

    describe.each(["captured", "inherited", "exec"] as const)("%s", mode => {
      test.each(scripts)("%s", async (script, expected) => {
        const result = await runScript(script, { input: "hi\n" }, mode);
        expect(result).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
      });
    });

    test("input spanning several reads", async () => {
      const input = Buffer.alloc(300_000, "abcdefghij\n").toString();
      const result = await runScript("cat; cat", { input });
      expect(result.stderr).toBe("");
      expect(result.stdout.length).toBe(input.length + "exit=0\n".length);
      expect(result.stdout).toBe(`${input}exit=0\n`);
      expect(result.exitCode).toBe(0);
    });

    test("stdin of a pipeline stage", async () => {
      const result = await runScript("echo hi | (cat; echo ---; cat)", { input: "" });
      expect(result).toEqual({ stdout: "hi\n---\nexit=0\n", stderr: "", exitCode: 0 });
    });

    // Bun.spawn's stdin pipe is a socketpair on POSIX; this is the same thing
    // over an actual pipe. (On Windows it is a pipe to begin with.)
    test.skipIf(isWindows)("stdin is a pipe", async () => {
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", 'printf "hi\\n" | "$0" -e "$1"', bunExe(), childCode("cat; echo ---; cat", true)],
        env: builtinEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hi\n---\nexit=0\n", stderr: "", exitCode: 0 });
    });

    // On a pipe the new read only reports EOF again, which looks the same as
    // completing the second cat on the spot. A tty's EOF (^D) is used up by the
    // read that sees it, so here the second cat only finishes if it really reads
    // the fd again and gets the input typed after the first cat is done. POSIX
    // only: on Windows the fd is closed at the first EOF, so the second cat
    // finishes on the spot there (the cases above).
    test.skipIf(isWindows)("stdin is a tty: the second cat reads the input typed for it", async () => {
      let output = "";
      const separator = Promise.withResolvers<void>();
      const trailer = Promise.withResolvers<void>();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", childCode("cat; echo ---; cat", false)],
        env: builtinEnv,
        terminal: {
          data(_, chunk) {
            output += Buffer.from(chunk).toString();
            if (output.includes("---\n")) separator.resolve();
            if (/exit=\d+\n/.test(output)) trailer.resolve();
          },
          // Fires once the exited child's output has all been delivered, so a
          // child that dies early fails the await below instead of timing out.
          // (A no-op for whichever promise the output above already resolved.)
          exit() {
            const error = new Error(`child exited early, output so far: ${JSON.stringify(output)}`);
            (output.includes("---\n") ? trailer : separator).reject(error);
          },
        },
      });
      await using terminal = proc.terminal!;
      // Same values on Linux and macOS. Without these the typed input would be
      // echoed into `output` and the child's "\n" would come back as "\r\n".
      // The child has nothing to read yet, so nothing has been output either.
      const ECHO = 0x8;
      const OPOST = 0x1;
      terminal.localFlags &= ~ECHO;
      terminal.outputFlags &= ~OPOST;
      terminal.write("hi\n\x04");
      await separator.promise;
      terminal.write("more\n\x04");
      await trailer.promise;
      expect(output).toBe("hi\n---\nmore\nexit=0\n");
      expect(await proc.exited).toBe(0);
    });

    // The first cat fails its stdout write from inside the read that delivered
    // the chunk and leaves. With captured output the rest of the script runs
    // before that read returns: the second cat registers from inside it and is
    // served by the EOF that read goes on to (when stdin has hung up already)
    // or by the next read. A third cat, started from the second one's EOF
    // notification, reads the fd again. With stdout going through an IOWriter,
    // `echo` completes later, so the first read ends with nobody listening and
    // the second cat starts a new one.
    describe.each([
      // The write to /dev/full fails at once.
      ["cat > /dev/full", "cat > /dev/full || echo first-failed", "first-failed\n", isLinux],
      // `true` is gone and `echo` has already failed on the pipe to it when the
      // cat gets its chunk, so the cat's write fails at once on every platform.
      ["(echo x; cat) | true", "(echo x; cat) | true", "", true],
    ])("first cat dies while its chunk is delivered: %s", (_, first, firstOutput, supported) => {
      test.skipIf(!supported).each([
        [`${first}; cat && echo second-ok`, "captured", "second-ok\n"],
        [`${first}; cat && echo second-ok; cat && echo third-ok`, "captured", "second-ok\nthird-ok\n"],
        [`${first}; cat && echo second-ok; ${subprocess}`, "captured", "second-ok\n"],
        [`${first}; cat && echo second-ok`, "inherited", "second-ok\n"],
      ] as const)("%s (%s)", async (script, mode, expected) => {
        const result = await runScript(script, { input: "hi\n" }, mode);
        expect(result).toEqual({ stdout: `${firstOutput}${expected}exit=0\n`, stderr: "", exitCode: 0 });
      });

      // The same with the hang-up guaranteed to be in the wakeup that delivers
      // the chunk: the read then runs on to EOF by itself after the second cat
      // registered, and that EOF serves the second cat. Nothing may report EOF
      // for it again while the script is in the subprocess, whose node reuses
      // the second cat's id: `panic: Cmd Node#2 is not running a builtin`.
      test.skipIf(!supported)("stdin hung up before the script starts", async () => {
        const script = `${first}; cat && echo second-ok; ${subprocess}`;
        const result = await runScriptOnPreparedStdin(script, async stdin => {
          stdin.write("hi\n");
          await stdin.end();
        });
        expect(result).toEqual({ stdout: `${firstOutput}second-ok\nexit=0\n`, stderr: "", exitCode: 0 });
      });
    });
  });

  // Stdin is a directory or /dev/null. On POSIX the reader of such an fd cannot
  // start and completes its cat from `start()`; on Windows its read fails.
  // What these pin down is that the failure is reported to that cat only, and
  // that a row of such cats completes on one trampoline (the debug build
  // asserts in Yield.rs when the completions nest).
  describe("when stdin cannot be read", () => {
    describe.each(["captured", "exec"] as const)("%s", mode => {
      test.each([
        "cat || echo first-failed; echo ---; cat || echo second-failed",
        // Second cat in a node id different from the first cat's (see above).
        "cat || echo first-failed; (echo ---; cat) || echo second-failed",
      ])("%s", async script => {
        const result = await runScript(script, { unpollable: import.meta.dir }, mode);
        expect(result).toEqual({ stdout: "first-failed\n---\nsecond-failed\nexit=0\n", stderr: "", exitCode: 0 });
      });

      // `stdin: "ignore"` in Bun.spawn is the same thing.
      test.skipIf(isWindows)("stdin is /dev/null", async () => {
        const result = await runScript("cat; (cat); echo done", { unpollable: "/dev/null" }, mode);
        expect(result).toEqual({ stdout: "done\nexit=0\n", stderr: "", exitCode: 0 });
      });
    });

    test("four cats in a row", async () => {
      const script = "cat || echo 1; cat || echo 2; cat || echo 3; cat || echo 4; echo ---";
      const result = await runScript(script, { unpollable: import.meta.dir });
      expect(result).toEqual({ stdout: "1\n2\n3\n4\n---\nexit=0\n", stderr: "", exitCode: 0 });
    });

    // Here the reader that cannot start is the one of a file operand, and the
    // cat is the last stage of a pipeline. Completed from inside its own start,
    // it took the pipeline down under the code that was still starting it:
    // `panic: expected Node::Pipeline at Node#2, got Free`.
    test.skipIf(isWindows)("a file operand, in the last stage of a pipeline", async () => {
      const result = await runScript("true | cat /; echo end", { input: "" });
      expect(result).toEqual({ stdout: "end\nexit=0\n", stderr: "", exitCode: 0 });
    });
  });

  // A command substitution reads the stdin of the script.
  describe("with a cat in a command substitution", () => {
    test.each([
      // Two cats listen at the same time: the one of the pipeline stage and
      // the one of the substitution.
      ["cat > /dev/null | echo [$(cat)]", "[hi]\n"],
      ["echo a$(cat)b; cat", "ahib\n"],
      ["echo $(cat) $(cat)", "hi\n"],
    ])("%s", async (script, expected) => {
      const result = await runScript(script, { input: "hi\n" });
      expect(result).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
    });

    // Of two cats that listen at the same time, one leaves on its first chunk
    // (its write fails). The other one still gets that chunk and, when the
    // reader goes on for it, the EOF that ends the pipeline.
    test.skipIf(!isLinux).each([
      ["cat > /dev/full | echo [$(cat)]", "[hi]\n"],
      ["cat | echo [$(cat > /dev/full)]", "[]\n"],
    ])("%s", async (script, expected) => {
      const result = await runScript(script, { input: "hi\n" });
      expect(result).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
    });

    test("cat | echo [$(cat)] when stdin cannot be read", async () => {
      const result = await runScript("cat | echo [$(cat)]", { unpollable: import.meta.dir });
      expect(result).toEqual({ stdout: "[]\nexit=0\n", stderr: "", exitCode: 0 });
    });
  });

  describe.skipIf(!isLinux)("after a read of stdin failed", () => {
    // The peer of the child's stdin closes with data of the child's still
    // unread (the line the `sh` wrapper writes into fd 0). A system `cat` run
    // twice gets the same: the first one fails after the data, the second one
    // sees EOF.
    test("the next cat reads the fd again", async () => {
      const input = Buffer.alloc(8192, "x").toString();
      const result = await runScriptOnPreparedStdin(
        "cat || echo first-failed; cat && echo second-ok",
        async stdin => {
          stdin.write(input);
          await stdin.end();
        },
        cmd => ["sh", "-c", 'echo unread >&0; exec "$0" "$@"', ...cmd],
      );
      expect(result.stdout.length).toBe(input.length + "first-failed\nsecond-ok\nexit=0\n".length);
      expect(result).toEqual({ stdout: `${input}first-failed\nsecond-ok\nexit=0\n`, stderr: "", exitCode: 0 });
    });

    // The first cat dies on the first chunk, and the read that goes on after
    // the hang-up then meets the error with nobody listening. The error is
    // not lost: the second cat gets what that read got, the bytes and then the
    // error, as it would when it read the fd itself. The third cat reads the
    // fd again and sees EOF.
    test.each([
      ["nothing was read in between", 8192, 0],
      ["bytes were read in between", 300_000, 300_000 - readSize],
    ])("an error met while nobody listened goes to the next cat: %s", async (_, queued, between) => {
      const result = await runScriptOnStdinFromPython(
        resetSocket,
        queued,
        `cat > /dev/full || echo first-failed; ${subprocess}; cat || echo second-failed; cat && echo third-ok`,
      );
      const expected = `first-failed\n${Buffer.alloc(between, "x").toString()}second-failed\nthird-ok\nexit=0\n`;
      expect(result.stdout.length).toBe(expected.length);
      expect(result).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });
  });
});

// Several reads' worth on every platform (the posix reader reads up to 256 KiB
// at a time, the Windows one 64 KiB), so the second reader also has to keep
// reading after the first chunk it gets.
const secondReaderInput = Buffer.alloc(300_000, "second reader's input\n").toString();

// Runs a script whose first `cat` reads the script's stdin and dies on its
// first chunk, then (once the test allows the script to go on) a second reader
// of the same stdin. The script's stdout is not captured, so `echo` goes
// through the event loop and the second reader only starts after the test has
// seen `ready`.
//
// The `gate` in the middle blocks the script between the two readers for as
// long as the test wants: everything written to stdin in the meantime arrives
// while no builtin is reading it, and a real shell would leave it in the fd
// for the second reader.
async function runTwoReaders(
  firstReader: string,
  secondReader: string,
  {
    input = secondReaderInput,
    writeInputAfter,
    closeStdin = "after the input was written",
    mode = "inherited",
  }: {
    input?: string;
    writeInputAfter: "first reader died" | "second reader started";
    // "before the second reader starts": only for input that fits in the pipe
    // (the write has to complete with nobody reading).
    // "after all of the input came back": stdin stays open until the second
    // reader has printed the input, so it cannot be the EOF that makes it print.
    closeStdin?: "before the second reader starts" | "after the input was written" | "after all of the input came back";
    mode?: "inherited" | "exec";
  },
) {
  const pinged = Promise.withResolvers<(response: Response) => void>();
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Promise<Response>(release => pinged.resolve(release)),
  });
  const script = `${firstReader}; ${gate}; echo ready; ${secondReader}`;
  await using proc = Bun.spawn({
    cmd: mode === "exec" ? [bunExe(), "exec", script] : [bunExe(), "-e", childCode(script, false)],
    env: { ...builtinEnv, RELEASE_URL: server.url.href },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdout = "";
  const decoder = new TextDecoder();
  const ready = Promise.withResolvers<void>();
  const cameBack = Promise.withResolvers<void>();
  const stdoutClosed = (async () => {
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      if (stdout.includes("ready\n")) ready.resolve();
      if (stdout.length >= "ready\n".length + input.length) cameBack.resolve();
    }
  })();
  const exitedEarly = proc.exited.then(code => {
    throw new Error(
      `the child exited with code ${code} before printing all it should; stdout so far: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  });

  // The first reader gets this line, tries to write it and dies; the script
  // reaches the gate only once it has.
  proc.stdin.write("first reader's input\n");
  proc.stdin.flush();
  const release = await Promise.race([pinged.promise, exitedEarly]);
  if (writeInputAfter === "first reader died") {
    // Not flushed to completion here: more than the pipe holds may be written,
    // and the rest can only go out once the second reader is consuming.
    proc.stdin.write(input);
    proc.stdin.flush();
    if (closeStdin === "before the second reader starts") await proc.stdin.end();
  }
  release(new Response());
  await Promise.race([ready.promise, exitedEarly]);
  if (writeInputAfter === "second reader started") {
    proc.stdin.write(input);
    proc.stdin.flush();
  }
  if (closeStdin === "after all of the input came back") await Promise.race([cameBack.promise, exitedEarly]);
  await proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, stdoutClosed]);
  // As in `runScript`: `bun exec` prints no trailer.
  if (mode === "exec") return { stdout: `${stdout}exit=${exitCode}\n`, stderr, exitCode: 0 };
  return { stdout, stderr, exitCode };
}

function expectAllOfTheInput(result: Awaited<ReturnType<typeof runTwoReaders>>) {
  const expected = `ready\n${secondReaderInput}exit=0\n`;
  expect(result.stderr).toBe("");
  // Sizes first: when the second reader misses part of the input, a diff of
  // 300 KB of identical lines says less than the two sizes do.
  expect(result.stdout.length).toBe(expected.length);
  expect(result).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
}

describe("cat (builtin) that stops reading stdin leaves the rest of stdin to the next reader", () => {
  describe.each([
    // `true` exits at once, so the first cat's write of its first chunk fails
    // with EPIPE later, from the event loop, after the read that delivered the
    // chunk was already re-armed.
    ["fails to write to a pipe nobody reads", "cat | true", true],
    // The write to /dev/full fails synchronously, while the chunk is being
    // delivered, so the first cat is gone before the read that delivered it
    // decides whether to re-arm.
    ["fails to write to /dev/full", "cat > /dev/full", isLinux],
  ])("first cat %s", (_, firstReader, supported) => {
    test.skipIf(!supported)("a later builtin cat prints the input written in between", async () => {
      expectAllOfTheInput(await runTwoReaders(firstReader, "cat", { writeInputAfter: "first reader died" }));
    });

    // What was written in between is printed at once, not only when stdin
    // closes. On Windows those bytes come from the read that was out when the
    // first cat died: the reader kept them, and the second cat must get them
    // when it starts, not together with the next thing that is read.
    test.skipIf(!supported)("a later builtin cat prints it while stdin is still open", async () => {
      const result = await runTwoReaders(firstReader, "cat", {
        input: "written in between\n",
        writeInputAfter: "first reader died",
        closeStdin: "after all of the input came back",
      });
      expect(result).toEqual({ stdout: "ready\nwritten in between\nexit=0\n", stderr: "", exitCode: 0 });
    });

    // Stdin is at EOF before the second reader starts. The first of its cats
    // gets what was written in between and the EOF, the second one the EOF.
    test.skipIf(!supported)("two later builtin cats after stdin closed: the input, then EOF", async () => {
      const result = await runTwoReaders(firstReader, "cat; echo ---; cat", {
        input: "written in between\n",
        writeInputAfter: "first reader died",
        closeStdin: "before the second reader starts",
      });
      expect(result).toEqual({ stdout: "ready\nwritten in between\n---\nexit=0\n", stderr: "", exitCode: 0 });
    });

    test.skipIf(!supported || isWindows)("a later subprocess prints the input written in between", async () => {
      expectAllOfTheInput(await runTwoReaders(firstReader, "/bin/cat", { writeInputAfter: "first reader died" }));
    });

    test.skipIf(!supported)("a later builtin cat reads input written after it started", async () => {
      expectAllOfTheInput(await runTwoReaders(firstReader, "cat", { writeInputAfter: "second reader started" }));
    });
  });

  test("through bun exec: a later builtin cat prints the input written in between", async () => {
    expectAllOfTheInput(
      await runTwoReaders("cat | true", "cat", { writeInputAfter: "first reader died", mode: "exec" }),
    );
  });

  // On Windows the read that is out when the first cat dies cannot be taken
  // back: it gets the first bytes written in between (at most one read of
  // 64 KiB) and the reader keeps them for a later builtin. Everything after
  // that must still be in the pipe for the subprocess, which is only the case
  // when the reader stopped.
  test.skipIf(!isWindows)("on Windows a later subprocess gets all but the one read that was out", async () => {
    const reader = `${bun} -e "process.stdin.pipe(process.stdout)"`;
    const result = await runTwoReaders("cat | true", reader, { writeInputAfter: "first reader died" });
    const received = result.stdout.slice("ready\n".length, -"exit=0\n".length);
    expect({
      isTailOfTheInput: secondReaderInput.endsWith(received),
      missesAtMostOneRead: received.length >= secondReaderInput.length - 64 * 1024,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }).toEqual({ isTailOfTheInput: true, missesAtMostOneRead: true, stderr: "", exitCode: 0 });
  });

  // Here the writer is gone before the first read and more than one read's
  // worth is queued. After a hang-up the POSIX reader reads on to EOF without
  // going back to the event loop, also when the first cat died on the first
  // chunk. What it reads then is kept for the next builtin cat.
  test.skipIf(!isLinux)("after the writer hung up: a later builtin cat gets the rest", async () => {
    const queued = 300_000;
    const result = await runScriptOnStdinFromPython(
      hungUpPipe,
      queued,
      `cat > /dev/full || echo first-failed; ${subprocess}; cat`,
    );
    const expected = `first-failed\n${Buffer.alloc(queued - readSize, "x").toString()}exit=0\n`;
    expect(result.stdout.length).toBe(expected.length);
    expect(result).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  });

  // Not yet: the bytes of the case above are in the shell's buffer, not in the
  // fd, so a subprocess does not see them.
  test.todo("after the writer hung up: a later subprocess gets the rest");

  // Not yet: a cat whose write is only slow (`cat | sleep 1`) keeps reading
  // stdin into memory, and nothing is left for the next reader.
  test.todo("a cat that waits for its write does not read ahead");
});
