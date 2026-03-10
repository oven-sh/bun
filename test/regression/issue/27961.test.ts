import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/27961
test.if(isWindows)("shell cp reports EBUSY instead of panicking when overwriting a running exe", async () => {
  using dir = tempDir("issue-27961", {});

  const cwd = String(dir);
  const dummyExe = join(cwd, "dummy-process.exe");
  const cpScript = [
    'import { $ } from "bun";',
    "$.throws(false);",
    `const src = ${JSON.stringify(bunExe())};`,
    `const dest = ${JSON.stringify(dummyExe)};`,
    "const result = await $`cp ${src} ${dest}`;",
    "process.exit(result.exitCode);",
  ].join("\n");

  await copyFile(bunExe(), dummyExe);

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
    cmd: [bunExe(), "-e", cpScript],
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

test.if(isWindows)("shell cp does not ignore non-EBUSY source-path failures for duplicate sources", async () => {
  using dir = tempDir("issue-27961-precedence", {});

  const cwd = String(dir);
  const source = join(cwd, "hello.txt");
  const filler = join(cwd, "filler.txt");
  const targetDir = join(cwd, "somedir");
  const cpScript = [
    'import { $ } from "bun";',
    "$.throws(false);",
    `const source = ${JSON.stringify(source)};`,
    `const filler = ${JSON.stringify(filler)};`,
    "const sources = [source, ...Array.from({ length: 512 }, () => filler), source];",
    `const result = await $\`cp -v ${"${sources}"} ${JSON.stringify(targetDir)}\`;`,
    "process.exit(result.exitCode);",
  ].join("\n");

  await Bun.write(source, Buffer.alloc(4096, "a"));
  await Bun.write(filler, Buffer.alloc(4096, "b"));
  await mkdir(targetDir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", cpScript],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const sourceDeleted = deleteAfterFirstCopy(proc.stdout, `${source} ->`, source);
  const [stderr, exitCode, deleted] = await Promise.all([proc.stderr.text(), proc.exited, sourceDeleted]);

  expect(deleted).toBe(true);
  expect(normalizeBunSnapshot(stderr, cwd)).toContain("No such file or directory");
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

async function deleteAfterFirstCopy(stream: ReadableStream<Uint8Array>, marker: string, source: string) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (!output.includes(marker)) {
      const chunk = await reader.read();
      if (chunk.done) {
        return false;
      }
      output += decoder.decode(chunk.value, { stream: true });
    }

    await unlink(source);
    return true;
  } finally {
    reader.releaseLock();
  }
}
