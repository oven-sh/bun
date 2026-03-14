import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.write with new Response(ReadableStream) that completes synchronously does not crash", async () => {
  using dir = tempDir("28090", {});

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const outFile = require("path").join(process.argv[1], "out.txt");
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("hello from sync stream"));
    controller.close();
  }
});
const written = await Bun.write(outFile, new Response(stream));
const content = await Bun.file(outFile).text();
console.log(JSON.stringify({ written, content }));
`,
      String(dir),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.content).toBe("hello from sync stream");
  expect(result.written).toBe(22);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("Bun.write with new Response(req.body) does not hang", async () => {
  using dir = tempDir("28090", {});

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const outFile = require("path").join(process.argv[1], "out.txt");

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const written = await Bun.write(outFile, new Response(req.body));
    return new Response(JSON.stringify({ written }));
  },
});

try {
  const resp = await fetch(server.url, {
    method: "POST",
    body: "hello from request body",
  });
  const result = await resp.json();
  const content = await Bun.file(outFile).text();
  console.log(JSON.stringify({ ...result, content }));
} finally {
  server.stop(true);
}
`,
      String(dir),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.content).toBe("hello from request body");
  expect(result.written).toBe(23);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
