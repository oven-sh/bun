// Several native error messages embed a string that comes from JS, so the
// length of the message is user controlled. Building one past
// `WTF::String::MaxLength` (2**31 - 1 characters) aborted the process
// (`panic(main thread): abort() called`, exit code 134) instead of reporting
// the error it was building. Each case below now reports `RangeError: Out of
// memory`, which is what JSC reports for a string it cannot create, and a
// stack trace that does not fit drops its frames.
//
// Every case needs a string of about 2 GiB, because the length is what is
// under test, so the block skips on small machines (the same gate
// source-too-large.test.ts uses). `repeat` is used instead of the harness's
// `Buffer.alloc(n, fill).toString()`: it is faster here and it allocates the
// 2 GiB once instead of twice.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";
import { totalmem } from "node:os";

const LENGTH = 2 ** 31 - 10;
const TIMEOUT = 120_000;

async function run(source: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// Reports the error the statement throws, or rejects with, as "Name: message".
function reportThrow(statement: string) {
  return `
    const long = "q".repeat(${LENGTH});
    class C {}
    Object.defineProperty(C, "name", { value: long });
    try {
      ${statement}
      console.log("did not throw");
    } catch (e) {
      console.log(e.name + ": " + e.message);
    }
  `;
}

describe.skipIf(totalmem() < 10 * 1024 ** 3)("an error message past the string length limit", () => {
  test(
    "throws instead of aborting for an unknown Buffer encoding",
    async () => {
      expect(await run(reportThrow(`Buffer.from("x", long);`))).toEqual({
        stdout: "RangeError: Out of memory",
        stderr: "",
        exitCode: 0,
      });
    },
    TIMEOUT,
  );

  test(
    "throws instead of aborting for a constructor name in ERR_INVALID_ARG_TYPE",
    async () => {
      expect(await run(reportThrow(`Buffer.from(new C());`))).toEqual({
        stdout: "RangeError: Out of memory",
        stderr: "",
        exitCode: 0,
      });
    },
    TIMEOUT,
  );

  test(
    "throws instead of aborting for a constructor name rendered for a Rust validator",
    async () => {
      const statement = `new (require("node:net").SocketAddress)({ address: "1.2.3.4", port: new C() });`;
      expect(await run(reportThrow(statement))).toEqual({
        stdout: "RangeError: Out of memory",
        stderr: "",
        exitCode: 0,
      });
    },
    TIMEOUT,
  );

  test(
    "throws instead of aborting for a missing performance mark",
    async () => {
      expect(await run(reportThrow(`performance.measure("m", long);`))).toEqual({
        stdout: "RangeError: Out of memory",
        stderr: "",
        exitCode: 0,
      });
    },
    TIMEOUT,
  );

  test(
    "rejects instead of aborting for an invalid SubtleCrypto key format",
    async () => {
      const source = `
        const long = "q".repeat(${LENGTH});
        try {
          await crypto.subtle.importKey(long, new Uint8Array(8), "AES-GCM", false, ["encrypt"]);
          console.log("did not reject");
        } catch (e) {
          console.log(e.name + ": " + e.message);
        }
      `;
      expect(await run(source)).toEqual({
        stdout: "RangeError: Out of memory",
        stderr: "",
        exitCode: 0,
      });
    },
    TIMEOUT,
  );

  test.skipIf(isWindows)(
    "throws instead of aborting for a process.execve environment entry",
    async () => {
      // process.execve prints an experimental warning to stderr, so only
      // stdout is asserted here.
      const { stdout, exitCode } = await run(reportThrow(`process.execve("/bin/true", [], { A: long });`));
      expect(stdout).toBe("RangeError: Out of memory");
      expect(exitCode).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "drops the frames instead of aborting when a stack trace does not fit",
    async () => {
      const source = `
        const long = "q".repeat(${LENGTH});
        const stack = new Error(long).stack;
        console.log(typeof stack, stack.length, stack.slice(0, 7));
      `;
      // "Error: " and the message still fit, the frames do not, so the stack
      // is the header alone.
      expect(await run(source)).toEqual({
        stdout: `string ${"Error: ".length + LENGTH} Error: `.trimEnd(),
        stderr: "",
        exitCode: 0,
      });
    },
    TIMEOUT,
  );

  // ERR_INVALID_ARG_VALUE quotes and escapes the value like `util.inspect`, so
  // a control character renders as 4 ("\x00"). 2**29 of them render to exactly
  // 2**31 characters, one past the limit, from a 512 MiB value. The renderer
  // escapes one character at a time. That takes seconds in a release build
  // and about 8 minutes in a debug build, so these two cases skip there.
  describe.skipIf(isDebug)("from a value that ERR_INVALID_ARG_VALUE escapes", () => {
    function reportThrowEscaped(statement: string) {
      return `
        const escaped = "\\x00".repeat(2 ** 29);
        try {
          ${statement}
          console.log("did not throw");
        } catch (e) {
          console.log(e.name + ": " + e.message);
        }
      `;
    }

    test(
      "throws instead of aborting for a Buffer#fill value that is not valid hex",
      async () => {
        expect(await run(reportThrowEscaped(`Buffer.alloc(4).fill(escaped, "hex");`))).toEqual({
          stdout: "RangeError: Out of memory",
          stderr: "",
          exitCode: 0,
        });
      },
      TIMEOUT,
    );

    test(
      "throws instead of aborting for a child_process.spawn file with null bytes",
      async () => {
        expect(await run(reportThrowEscaped(`require("node:child_process").spawn(escaped);`))).toEqual({
          stdout: "RangeError: Out of memory",
          stderr: "",
          exitCode: 0,
        });
      },
      TIMEOUT,
    );
  });
});
