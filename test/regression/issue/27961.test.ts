import { expect, test } from "bun:test";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27961
test.if(isWindows)("shell cp reports EBUSY instead of panicking when overwriting a running exe", async () => {
  using dir = tempDir("issue-27961", {});

  const cwd = String(dir);
  const dummyExe = join(cwd, "dummy-process.exe");
  const runner = join(cwd, "run-cp.js");

  await copyFile(bunExe(), dummyExe);
  await Bun.write(
    runner,
    [
      'import { $ } from "bun";',
      "$.throws(false);",
      `const src = ${JSON.stringify(bunExe())};`,
      `const dest = ${JSON.stringify(dummyExe)};`,
      "const result = await $`cp ${src} ${dest}`;",
      "process.exit(result.exitCode);",
    ].join("\n"),
  );

  await using holder = Bun.spawn({
    cmd: [dummyExe, "-e", 'console.log("ready"); process.stdin.resume();'],
    cwd,
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForReady(holder.stdout);

  await using proc = Bun.spawn({
    cmd: [bunExe(), runner],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  holder.kill();
  await holder.exited;

  expect(stdout).toBe("");
  expect(normalizeBunSnapshot(stderr, cwd)).toBe("cp: Device or resource busy: <dir>/dummy-process.exe");
  expect(exitCode).toBe(1);
});

async function waitForReady(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (!output.includes("ready\n")) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error(`process exited before signaling readiness: ${output}`);
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
