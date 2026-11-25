import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("each file of --isolate runs the ticks of the microtask that made its queue ahead of later microtasks", async () => {
  using dir = tempDir("isolation-first-ticks", {
    "a.test.js": `import { test } from "bun:test"; test("a", async () => { await 0; process.nextTick(() => {}); await new Promise(r => setTimeout(r, 1)); });`,
    "b.test.js": `import { test } from "bun:test"; test("b", async () => { const log = []; await 0; process.nextTick(() => log.push("tick")); Promise.resolve().then(() => log.push("micro")); await new Promise(r => setTimeout(r, 1)); console.log("B " + log.join()); });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "a.test.js", "b.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("B tick,micro");
  expect(stderr).toContain("2 pass");
  expect(exitCode).toBe(0);
});
