import { $, ShellError, ShellPromise } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
import { totalmem } from "os";

describe("ShellOutput + ShellError", () => {
  test("output", async () => {
    let output = await $`echo hi`;
    expect(output.text()).toBe("hi\n");
    output = await $`echo '{"hello": 123}'`;
    expect(output.json()).toEqual({ hello: 123 });
    output = await $`echo hello`;
    expect(output.blob()).toEqual(new Blob([new TextEncoder().encode("hello")]));
  });

  test("error", async () => {
    $.throws(true);
    let output = await withErr($`echo hi; ls oogabooga`);
    expect(output.stderr.toString()).toEqual("ls: oogabooga: No such file or directory\n");
    expect(output.text()).toBe("hi\n");
    output = await withErr($`echo '{"hello": 123}'; ls oogabooga`);
    expect(output.stderr.toString()).toEqual("ls: oogabooga: No such file or directory\n");
    expect(output.json()).toEqual({ hello: 123 });
    output = await withErr($`echo hello; ls oogabooga`);
    expect(output.stderr.toString()).toEqual("ls: oogabooga: No such file or directory\n");
    expect(output.blob()).toEqual(new Blob([new TextEncoder().encode("hello")]));
  });
});

// The shell hands its captured stdout to JSC as a Buffer, which holds at most
// kMaxLength (2^32) bytes. A larger capture used to abort the process at that
// hand-off, and the rejection path behind it (the interpreter's `reject`
// callback) had never carried an error. This is the only way to exercise it. The
// child holds 4 GiB of zeros (8 GiB while its buffer grows), so this runs in a
// child process, with a long timeout, and only on machines with room.
describe.skipIf(!isPosix || totalmem() < 16 * 1024 ** 3)("stdout at the Buffer length limit", () => {
  test("a capture of 2^32 + 1 bytes rejects with the RangeError that new ArrayBuffer(2 ** 32 + 1) throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const size = String(2 ** 32 + 1);
        const result = await Bun.$\`head -c \${size} /dev/zero\`.quiet().then(
          out => ({ length: out.stdout.length }),
          e => ({ isRangeError: e instanceof RangeError, message: e.message }),
        );
        console.log(JSON.stringify(result));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      result: { isRangeError: true, message: "Out of memory" },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 120_000);
});

async function withErr(promise: ShellPromise): Promise<ShellError> {
  let err: ShellError | undefined;
  try {
    await promise;
  } catch (e) {
    err = e as ShellError;
  }
  expect(err).toBeDefined();
  return err as ShellError;
}
