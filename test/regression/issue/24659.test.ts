import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("custom ReadableStream can be written to file", async () => {
  using dir = tempDir("issue-24659", {
    "custom-stream.ts": `
const stream = new ReadableStream({
  start(controller) {
    const chunks = ['A', 'B', 'C', 'D', 'E'];
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  },
});

console.log('Writing to file');
const size = await Bun.write('text.txt', new Response(stream));
console.log(\`Wrote \${size} bytes\`);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "custom-stream.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("Writing to file");
  expect(stdout).toContain("Wrote 5 bytes");
  expect(exitCode).toBe(0);
});

test("wrapped Response body can be written to file", async () => {
  using dir = tempDir("issue-24659-wrapped", {
    "wrapped-stream.ts": `
const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("Hello World");
  },
});

const res = await fetch(\`http://localhost:\${server.port}\`);
const stream = res.body!;

console.log('Writing to file');
const size = await Bun.write('example.txt', new Response(stream));
console.log(\`Wrote \${size} bytes\`);

server.stop();
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "wrapped-stream.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("Writing to file");
  expect(stdout).toContain("Wrote 11 bytes");
  expect(exitCode).toBe(0);
});

test("teed ReadableStream can be written to file", async () => {
  using dir = tempDir("issue-24659-tee", {
    "tee-stream.ts": `
const stream = new ReadableStream({
  start(controller) {
    const chunks = ['A', 'B', 'C', 'D', 'E'];
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  },
});

const [newStream, _] = stream.tee();

console.log('Writing to file');
const size = await Bun.write('tee.txt', new Response(newStream));
console.log(\`Wrote \${size} bytes\`);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "tee-stream.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("Writing to file");
  expect(stdout).toContain("Wrote 5 bytes");
  expect(exitCode).toBe(0);
});
