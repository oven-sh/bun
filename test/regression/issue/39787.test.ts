import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/39787
// On Windows, a rejecting Bun.file() read settled its promise inside a libuv
// callback with no microtask checkpoint. If the read was the only pending
// work, the process exited 0 before the await continuation ran.
test("a rejecting Bun.file() read runs its continuation before the process exits", async () => {
  using dir = tempDir("issue-39787", {});
  const missing = join(String(dir), "definitely-missing-file.txt");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `async function main() {
        try {
          await Bun.file(${JSON.stringify(missing)}).text();
          console.log("UNEXPECTED RESOLVE");
        } catch (e) {
          console.log("CAUGHT " + e.code);
        }
        console.log("DONE");
      }
      main();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("CAUGHT ENOENT\nDONE\n");
  expect(exitCode).toBe(0);
});
