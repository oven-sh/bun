import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";

// The builtin `cat` is the default on Windows; on POSIX it needs this flag,
// otherwise `cat` is the system binary.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

// Runs, in a child bun, a script whose first `cat` reads the script's stdin and
// dies on its first chunk, then (once the test allows the script to go on) a
// second reader of the same stdin. Prints the script's stdout followed by an
// `exit=<code>` trailer. The script's stdout is not captured, so `echo` goes
// through the event loop and the second reader only starts after the test has
// seen `ready`.
//
// The `fetch` in the middle blocks the script between the two readers for as
// long as the test wants: everything written to stdin in the meantime arrives
// while no builtin is reading it, and a real shell would leave it in the fd
// for the second reader.
const childCode = `
  const result = await Bun.$\`\${{ raw: process.env.FIRST_READER }};
    \${process.execPath} -e \${"await (await fetch(process.env.RELEASE_URL)).text()"};
    echo ready;
    \${{ raw: process.env.SECOND_READER }}\`.nothrow();
  process.stdout.write("exit=" + result.exitCode + "\\n");
`;

// Several reads' worth on every platform (the posix reader reads up to 256 KiB
// at a time, the Windows one 64 KiB), so the second reader also has to keep
// reading after the first chunk it gets.
const input = Buffer.alloc(300_000, "second reader's input\n").toString();

const decoder = new TextDecoder();

async function runScript(
  firstReader: string,
  secondReader: string,
  { writeInputAfter }: { writeInputAfter: "first reader died" | "second reader started" },
) {
  const pinged = Promise.withResolvers<(response: Response) => void>();
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Promise<Response>(release => pinged.resolve(release)),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", childCode],
    env: {
      ...builtinEnv,
      FIRST_READER: firstReader,
      SECOND_READER: secondReader,
      RELEASE_URL: server.url.href,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdout = "";
  const ready = Promise.withResolvers<void>();
  const stdoutClosed = (async () => {
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      if (stdout.includes("ready\n")) ready.resolve();
    }
  })();
  const exitedEarly = proc.exited.then(code => {
    throw new Error(
      `the child exited with code ${code} before printing ready; stdout so far: ${JSON.stringify(stdout)}`,
    );
  });

  // The first reader gets this line, tries to write it and dies; the script
  // reaches the `fetch` only once it has.
  proc.stdin.write("first reader's input\n");
  proc.stdin.flush();
  const release = await Promise.race([pinged.promise, exitedEarly]);
  if (writeInputAfter === "first reader died") {
    // Not flushed to completion here: more than the pipe holds is written, and
    // the rest can only go out once the second reader is consuming.
    proc.stdin.write(input);
    proc.stdin.flush();
  }
  release(new Response());
  await Promise.race([ready.promise, exitedEarly]);
  if (writeInputAfter === "second reader started") {
    proc.stdin.write(input);
  }
  await proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, stdoutClosed]);
  return { stdout, stderr, exitCode };
}

const expectedStdout = `ready\n${input}exit=0\n`;

function expectAllOfTheInput(result: Awaited<ReturnType<typeof runScript>>) {
  expect(result.stderr).toBe("");
  // Sizes first: when the second reader misses part of the input, a diff of
  // 300 KB of identical lines says less than the two sizes do.
  expect(result.stdout.length).toBe(expectedStdout.length);
  expect(result).toEqual({ stdout: expectedStdout, stderr: "", exitCode: 0 });
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
    test.concurrent.skipIf(!supported)("a later builtin cat prints the input written in between", async () => {
      expectAllOfTheInput(await runScript(firstReader, "cat", { writeInputAfter: "first reader died" }));
    });

    // On Windows the read that was in flight when the first cat died cannot be
    // cancelled, so the shell keeps that one chunk for a later builtin only; a
    // subprocess seeing everything is a POSIX guarantee.
    test.concurrent.skipIf(!supported || isWindows)(
      "a later subprocess prints the input written in between",
      async () => {
        expectAllOfTheInput(await runScript(firstReader, "/bin/cat", { writeInputAfter: "first reader died" }));
      },
    );

    test.concurrent.skipIf(!supported)("a later builtin cat reads input written after it started", async () => {
      expectAllOfTheInput(await runScript(firstReader, "cat", { writeInputAfter: "second reader started" }));
    });
  });
});
