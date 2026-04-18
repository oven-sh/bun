import { pathToFileURL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// On Windows, UNC paths map the first segment to the URL host. When that
// segment is not a valid URL host (e.g. `\\?\C:\foo` → host `%3F`, or
// `\\@\share` → host `@`), DOMURL::create throws and toJSNewlyCreated returns
// an empty JSValue. Without an exception check, the subsequent
// jsCast<JSDOMURL*>(...)->wrapped() dereferences null and crashes.
//
// On POSIX, fileURLWithFileSystemPath always produces an empty host so
// construction never fails; these inputs just resolve to paths under cwd.
describe("Bun.pathToFileURL with inputs that fail URL construction", () => {
  const inputs = [
    "\\\\?\\C:\\Windows\\System32", // Windows extended-length path prefix
    "\\\\@\\share",
    "\\\\<\\share",
    "\\\\a b\\share",
    "\\\\a:b\\share",
  ];

  test("does not crash in a subprocess", async () => {
    const src = `
      const inputs = ${JSON.stringify(inputs)};
      for (const input of inputs) {
        try {
          const url = Bun.pathToFileURL(input);
          console.log("ok", JSON.stringify(url.href));
        } catch (e) {
          console.log("threw", e?.constructor?.name);
        }
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    // One line per input: either a valid URL or a thrown TypeError — never a crash.
    expect(stdout.trim().split("\n")).toEqual(inputs.map(() => expect.stringMatching(/^(ok ".*"|threw TypeError)$/)));
    expect(exitCode).toBe(0);
  });

  // On Windows these inputs cannot produce a valid file URL, so they must
  // throw cleanly instead of segfaulting.
  test.skipIf(!isWindows)("throws TypeError on Windows for UNC paths with invalid hosts", () => {
    for (const input of inputs) {
      expect(() => pathToFileURL(input)).toThrow(TypeError);
    }
  });
});
