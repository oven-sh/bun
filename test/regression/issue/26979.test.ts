import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/26979
// Bun.spawn with stdin: new Response(data) causes heap corruption when
// concurrent GC pressure exists (e.g. Bun.file().exists() calls and
// another spawn's stdout read). The ReadableStream created from the
// Response body was not protected from garbage collection between
// extraction and when the FileSink took a strong reference.
test("Bun.spawn stdin with Response body does not crash under GC pressure", async () => {
  // Run in a subprocess to detect crashes (segfault / assertion failure)
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
async function run() {
  const fileOps = Array.from({ length: 10 }, () => Bun.file("/tmp/nope").exists());

  const outer = Bun.spawn(["cat"], {
    stdin: new Response("y".repeat(100)),
    stdout: "pipe",
    stderr: "pipe"
  });
  const outerText = new Response(outer.stdout).text();

  const inner = Bun.spawn(["cat"], {
    stdin: new Response("x".repeat(20000)),
    stdout: "pipe"
  });
  const innerText = await new Response(inner.stdout).text();
  if (innerText !== "x".repeat(20000)) throw new Error("inner mismatch: " + innerText.length);

  await inner.exited;
  const outerResult = await outerText;
  if (outerResult !== "y".repeat(100)) throw new Error("outer mismatch: " + outerResult.length);
  await outer.exited;
  await Promise.all(fileOps);
}

await run();
await run();
await run();
console.log("OK");
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 30_000);
