import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("FileSink truncates existing file", async () => {
  using dir = tempDir("issue-25968", {});
  const filePath = `${dir}/file.txt`;

  // Write initial long content
  const file = Bun.file(filePath);
  await Bun.write(file, "Long content");

  // Write shorter content using writer
  const writer = file.writer();
  writer.write("Short");
  writer.end();

  // Verify the file is truncated and only contains the new content
  const result = await file.text();
  expect(result).toBe("Short");
});

test("FileSink truncates when writing to existing file via spawn", async () => {
  using dir = tempDir("issue-25968-spawn", {});
  const filePath = `${dir}/file.txt`;

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const file = Bun.file("${filePath.replace(/\\/g, "\\\\")}");
await Bun.write(file, "Long content that is longer");
const writer = file.writer();
writer.write("Short");
writer.end();
console.log(await file.text());
`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("Short");
  expect(exitCode).toBe(0);
});
