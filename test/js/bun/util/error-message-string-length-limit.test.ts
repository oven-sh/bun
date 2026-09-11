// Several native error messages embed a string that comes from JS, so the
// length of the message is user controlled. Building one past
// `WTF::String::MaxLength` (2**31 - 1 characters) aborted the process
// (`panic(main thread): abort() called`, exit code 134) instead of reporting
// the error it was building. Each case below now reports `RangeError: Out of
// memory`, which is what JSC reports for a string it cannot create.
//
// The length is what is under test, so the input is a string of about 2 GiB and
// the test skips on small machines (the same gate source-too-large.test.ts
// uses). One child runs every case, so that string is allocated once. `repeat`
// is used instead of the harness's `Buffer.alloc(n, fill).toString()`: it is
// faster here and it allocates the 2 GiB once instead of twice.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { totalmem } from "node:os";

const LENGTH = 2 ** 31 - 10;

// Each case prints its line as soon as it finishes. If a case aborts the child,
// the diff shows which one.
const fixture = `
  import { SocketAddress } from "node:net";

  const long = "q".repeat(${LENGTH});
  class C {}
  Object.defineProperty(C, "name", { value: long });

  const cases = {
    "unknown Buffer encoding": () => Buffer.from("x", long),
    "constructor name in ERR_INVALID_ARG_TYPE": () => Buffer.from(new C()),
    "constructor name in the Buffer#indexOf message": () => Buffer.alloc(1).indexOf(new C()),
    "constructor name rendered for a Rust validator": () => new SocketAddress({ address: "1.2.3.4", port: new C() }),
    "missing performance mark": () => performance.measure("m", long),
    "invalid SubtleCrypto key format": () => crypto.subtle.importKey(long, new Uint8Array(8), "AES-GCM", false, ["encrypt"]),
    "invalid ReadableStream source type": () => new ReadableStream({ type: long }),
    "value that ReadableStream.from cannot iterate": () => ReadableStream.from(Symbol(long)),
  };
  for (const [name, run] of Object.entries(cases)) {
    try {
      await run();
      console.log(name + ": did not throw");
    } catch (e) {
      console.log(name + ": " + e.name + ": " + e.message);
    }
  }
`;

// The child touches about 4.4 GB of pages: the string, and one rendering of it
// for the last case. That takes 3 to 4 seconds in a debug ASAN build and more
// on a loaded machine, which is too close to the default 5 second limit, so
// this one test carries its own ceiling.
test.skipIf(totalmem() < 10 * 1024 ** 3)(
  "an error message past the string length limit is thrown instead of aborting the process",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: [
        "unknown Buffer encoding: RangeError: Out of memory",
        "constructor name in ERR_INVALID_ARG_TYPE: RangeError: Out of memory",
        "constructor name in the Buffer#indexOf message: RangeError: Out of memory",
        "constructor name rendered for a Rust validator: RangeError: Out of memory",
        "missing performance mark: RangeError: Out of memory",
        "invalid SubtleCrypto key format: RangeError: Out of memory",
        "invalid ReadableStream source type: RangeError: Out of memory",
        "value that ReadableStream.from cannot iterate: RangeError: Out of memory",
      ],
      stderr: "",
      exitCode: 0,
    });
  },
  30_000,
);
