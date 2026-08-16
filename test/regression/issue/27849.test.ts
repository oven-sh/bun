import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27849
// Calling Bun.stdin.exists() before reading stdin caused
// the read to return empty on Linux because resolveSize()
// incorrectly set the blob size to 0 for pipes.

async function runStdinTest(script: string, input = "hello from pipe\n") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(input);
  proc.stdin.end();

  return await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
}

test("Bun.stdin.stream() works after Bun.stdin.exists()", async () => {
  const [stdout, stderr, exitCode] = await runStdinTest(`
    await Bun.stdin.exists();
    const chunks = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk).toString());
    }
    process.stdout.write(chunks.join(""));
  `);

  expect(stdout.trim()).toBe("hello from pipe");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("Bun.stdin.text() works after Bun.stdin.exists()", async () => {
  const [stdout, stderr, exitCode] = await runStdinTest(`
    await Bun.stdin.exists();
    process.stdout.write(await Bun.stdin.text());
  `);

  expect(stdout.trim()).toBe("hello from pipe");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("Bun.stdin.stream() works after accessing Bun.stdin.size", async () => {
  const [stdout, stderr, exitCode] = await runStdinTest(`
    const s = Bun.stdin.size;
    const chunks = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk).toString());
    }
    process.stdout.write(chunks.join(""));
  `);

  expect(stdout.trim()).toBe("hello from pipe");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
