// macOS and FreeBSD open /dev/fd/N, /dev/stdin, /dev/stdout and /dev/stderr as a dup of that
// descriptor. The new fd shares its offset and O_APPEND, and O_TRUNC does not empty the file.
// So a write to one of these names is a write to the caller's descriptor: the bytes go to its
// position and the rest of the file stays. Linux opens the file again, so there these names
// behave like any other path.
import { expect, it } from "bun:test";
import { bunEnv, bunExe, isFreeBSD, isMacOS, tempDir } from "harness";
import fs from "node:fs";
import { join } from "node:path";

export const opensAsDup = isMacOS || isFreeBSD;

/** "AAASS" -> "A×3 S×2" */
export const runs = (text: string) => text.replace(/(.)\1*/gs, run => `${run[0]}×${run.length} `).trim();

/** A call that writes `size` bytes of "S" to the path that the expression `dest` gives. */
export type Writer = { title: string; write: (dest: string) => string; size: number; result: string };
/** A call that writes no bytes to /dev/stdout. */
export type EmptyWriter = { title: string; write: string; result: string };

const appended = (before: string) => (size: number) => `${before} S×${size}`;
const fromStart = (size: number) => (size < 200 ? `S×${size} A×${200 - size}` : `S×${size}`);

// `shell` runs the script with one descriptor on the log, which holds 200 bytes of "A".
// `report` is the fd for the result of the call, and `after` is the log after `size` bytes.
const redirects = [
  {
    title: "a file that stdout appends to (>>)",
    shell: `"$EXE" -e "$SCRIPT" >> "$LOG"`,
    dest: `"/dev/stdout"`,
    report: 2,
    before: "",
    after: appended("A×200"),
  },
  {
    title: "a file that stdout already wrote to (>)",
    shell: `"$EXE" -e "$SCRIPT" > "$LOG"`,
    dest: `"/dev/stdout"`,
    report: 2,
    before: `fs.writeSync(1, Buffer.alloc(200, "H"));`,
    after: appended("H×200"),
  },
  {
    title: "a file that stderr appends to (2>>)",
    shell: `"$EXE" -e "$SCRIPT" 2>> "$LOG"`,
    dest: `"/dev/stderr"`,
    report: 1,
    before: "",
    after: appended("A×200"),
  },
  {
    title: "a file that stdout reads and writes from its start (1<>)",
    shell: `"$EXE" -e "$SCRIPT" 1<> "$LOG"`,
    dest: `"/dev/stdout"`,
    report: 2,
    before: "",
    after: fromStart,
  },
  {
    title: "a file that stdin reads and writes from its start (0<>)",
    shell: `"$EXE" -e "$SCRIPT" 0<> "$LOG"`,
    dest: `"/dev/stdin"`,
    report: 2,
    before: "",
    after: fromStart,
  },
  // FreeBSD has /dev/fd/3 only where fdescfs is mounted.
  ...(isMacOS
    ? [
        {
          title: "a file that fd 3 appends to (3>>)",
          shell: `"$EXE" -e "$SCRIPT" 3>> "$LOG"`,
          dest: `"/dev/fd/3"`,
          report: 2,
          before: "",
          after: appended("A×200"),
        },
        {
          title: "a file that fd 3 reads and writes from its start (3<>)",
          shell: `"$EXE" -e "$SCRIPT" 3<> "$LOG"`,
          dest: `"/dev/fd/3"`,
          report: 2,
          before: "",
          after: fromStart,
        },
      ]
    : []),
];

/** Runs `script` with `exe` in a child under `sh -c shell`. `$SRC`, `$LARGE_SRC` and `$EMPTY_SRC` are files of "S". */
export async function run(shell: string, script: string, exe: string = bunExe()) {
  using dir = tempDir("dup-path-destination", {
    "src.bin": Buffer.alloc(100, "S").toString(),
    "large.bin": Buffer.alloc(300_000, "S").toString(),
    "empty.bin": "",
    "log.txt": Buffer.alloc(200, "A").toString(),
  });
  const file = (name: string) => join(String(dir), name);
  fs.symlinkSync("/dev/stdout", file("stdout-link"));
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", shell],
    env: {
      ...bunEnv,
      EXE: exe,
      // node -e has no top-level await beside require().
      SCRIPT: `const fs = require("fs"); (async () => { ${script} })();`,
      SRC: file("src.bin"),
      LARGE_SRC: file("large.bin"),
      EMPTY_SRC: file("empty.bin"),
      LOG: file("log.txt"),
      LINK: file("stdout-link"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, log: runs(fs.readFileSync(file("log.txt"), "utf8")) };
}

/** Each writer against each redirect and a pipe, and each empty writer against `>>`. `exe` runs the calls. */
export function dupPathDestinationRows(writers: Writer[], emptyWriters: EmptyWriter[], exe: string = bunExe()) {
  for (const { title, write, size, result } of writers) {
    for (const redirect of redirects) {
      it.concurrent(`${title} keeps the other bytes of ${redirect.title}`, async () => {
        const script = `${redirect.before} const result = ${write(redirect.dest)}; fs.writeSync(${redirect.report}, String(result));`;
        const { stdout, stderr, exitCode, log } = await run(redirect.shell, script, exe);

        expect({
          reported: redirect.report === 1 ? stdout : stderr,
          other: redirect.report === 1 ? stderr : stdout,
          log,
        }).toEqual({ reported: result, other: "", log: redirect.after(size) });
        expect(exitCode).toBe(0);
      });
    }

    it.concurrent(`${title} writes to a pipe through /dev/stdout`, async () => {
      const script = `const result = ${write(`"/dev/stdout"`)}; fs.writeSync(2, String(result));`;
      const { stdout, stderr, exitCode } = await run(`"$EXE" -e "$SCRIPT" | cat`, script, exe);

      expect({ stdout: runs(stdout), stderr }).toEqual({ stdout: `S×${size}`, stderr: result });
      expect(exitCode).toBe(0);
    });
  }

  for (const { title, write, result } of emptyWriters) {
    it.concurrent(`${title} leaves a file that stdout appends to (>>) as it is`, async () => {
      const script = `const result = ${write}; fs.writeSync(2, String(result));`;
      const { stdout, stderr, exitCode, log } = await run(`"$EXE" -e "$SCRIPT" >> "$LOG"`, script, exe);

      expect({ stdout, stderr, log }).toEqual({ stdout: "", stderr: result, log: "A×200" });
      expect(exitCode).toBe(0);
    });
  }
}
