// Command lines of `python3`, and what CPython 3.15 did with them: see README.md and tools/command_line.py.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { closeSync, openSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import data from "./command-line/cases.json";
import expected from "./command-line/expected.json";
import expectedFailures from "./expected-failures.json";

// Each test is a program, and many run at a time. These builds take seconds to start Python.
setDefaultTimeout(isDebug || isASAN ? 300_000 : 60_000);

interface Case {
  name: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
  stdoutIsFull?: boolean;
  ignoreStderr?: boolean;
}

// As bytes.decode("utf-8", "backslashreplace") in Python.
function decode(bytes: Uint8Array): string {
  const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    return strict.decode(bytes);
  } catch {}
  let text = "";
  next: for (let i = 0; i < bytes.length;) {
    for (let length = 1; length <= 4 && i + length <= bytes.length; length++) {
      try {
        text += strict.decode(bytes.subarray(i, i + length));
        i += length;
        continue next;
      } catch {}
    }
    text += "\\x" + bytes[i++].toString(16).padStart(2, "0");
  }
  return text;
}

// As in tools/command_line.py.
const clean = (text: string, directory: string) =>
  text
    .replaceAll(directory, "<dir>")
    .replace(/\/\S*\/python3(\.15)?\b(?!\/)/g, "<python>")
    .replace(/3\.15\.\d+ \(.*\) \[.*\]/g, "<version>")
    .replace(/ at 0x[0-9a-f]+/g, " at 0x")
    .split("\n")
    // FIXME: The carets under the source line of a traceback are not done yet.
    .filter(line => !/^\s*[~^]+\s*$/.test(line))
    .join("\n");

// /dev/full, and what the C library says of errors.
describe.skipIf(!isLinux).concurrent("python3", () => {
  for (const { name, args, env, stdin, stdoutIsFull, ignoreStderr } of data.cases as Case[]) {
    test(name, async () => {
      using dir = tempDir("python-command-line", data.files);
      using bin = tempDir("python-command-line-bin", {});
      const directory = realpathSync(String(dir));
      for (const [link, target] of Object.entries(data.links)) symlinkSync(target, join(directory, link));
      for (const [file, text] of Object.entries(data.base64))
        writeFileSync(join(directory, file), Buffer.from(text, "base64"));
      const python = join(realpathSync(String(bin)), "python3");
      symlinkSync(bunExe(), python);

      const full = stdoutIsFull ? openSync("/dev/full", "w") : undefined;
      await using proc = Bun.spawn({
        cmd: [python, ...args],
        env: {
          ...Object.fromEntries(Object.entries(bunEnv).filter(([key]) => /^(BUN|ASAN|LSAN)_/.test(key))),
          PATH: "/usr/bin:/bin",
          HOME: directory,
          LANG: "C.UTF-8",
          ...env,
        },
        cwd: directory,
        // The interactive interpreter is not to find a terminal.
        detached: true,
        stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
        stdout: full ?? "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        stdoutIsFull ? null : (proc.stdout as ReadableStream).bytes(),
        proc.stderr.bytes(),
        proc.exited,
      ]);
      if (full !== undefined) closeSync(full);
      const got = {
        stdout: stdout === null ? null : clean(decode(stdout), directory),
        stderr: ignoreStderr ? null : clean(decode(stderr), directory),
        status: proc.signalCode ? -constants.signals[proc.signalCode] : exitCode,
      };

      const wanted = (expected as Record<string, typeof got>)[name];
      const reason = (expectedFailures as Record<string, string>)["command-line/" + name];
      if (reason === undefined) expect(got).toEqual(wanted);
      // It is to be taken off the list then.
      else expect(got, `it passes, and expected-failures.json says: ${reason}`).not.toEqual(wanted);
    });
  }
});
