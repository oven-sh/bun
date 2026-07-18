import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/31887
// Rejecting a type:"direct" stdin ReadableStream while the child is still
// exiting must not UAF Subprocess::on_process_exit via a dangling FileSink.
test("spawn stdin direct stream reject does not crash on process exit", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const child = Bun.spawn({
  stdin: new ReadableStream({
    type: "direct",
    async pull(c) {
      c.write(new TextEncoder().encode("y"));
      await Bun.sleep(10);
      throw new Error("boom");
    },
  }),
  cmd: ["sh", "-c", "sleep 0.2; cat >/dev/null"],
  stdout: "ignore",
  stderr: "ignore",
});
await child.exited.catch(() => {});
console.log("ok", child.exitCode ?? 0);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("AddressSanitizer");
  expect(stderr).not.toContain("heap-use-after-free");
  expect(stdout.trim()).toMatch(/^ok /);
  expect(exitCode).toBe(0);
});
