import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Worker preload: unresolvable module surfaces the resolve error, not 'undefined'", async () => {
  using dir = tempDir("worker-preload-resolve-error", {
    "entry.js": `postMessage("unreachable");`,
    "run.js": `
      try {
        new Worker(new URL("entry.js", import.meta.url).href, {
          preload: ["./this-preload-does-not-exist.js"],
        });
        console.log("NO_THROW");
      } catch (e) {
        console.log(JSON.stringify({ isError: e instanceof Error, message: String(e.message) }));
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const out = JSON.parse(stdout.trim());
  expect(out.isError).toBe(true);
  expect(out.message).not.toBe("undefined");
  expect(out.message).toContain("this-preload-does-not-exist");
  expect(exitCode).toBe(0);
});
