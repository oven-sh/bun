import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/28295
test("Bun.cron() accepts file:// URLs for path argument", async () => {
  const title = `bun-cron-file-url-test-${Math.random().toString(36).slice(2)}`;
  using dir = tempDir("bun-cron-file-url", {
    "entry.ts": `console.log("ok");`,
    "register-fixture.ts": `
      import { cron } from "bun";
      const title = process.argv[2];
      const resolved = import.meta.resolve("./entry.ts");
      if (!resolved.startsWith("file://")) {
        console.error("import.meta.resolve did not return a file:// URL");
        process.exit(2);
      }
      let registered = false;
      try {
        await cron(resolved, "0 0 * * *", title);
        registered = true;
        console.log("registered");
      } finally {
        if (registered) try { await cron.remove(title); } catch {}
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "register-fixture.ts", title],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Failed to resolve path");
  if (exitCode === 0) {
    expect(stdout).toContain("registered");
  } else {
    expect(stderr).not.toContain("TypeError");
  }
  expect(exitCode).not.toBe(2);
});
