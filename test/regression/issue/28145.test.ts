import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("compiled binary does not truncate stdout when piped", async () => {
  // Create a JS file that outputs more than 8192 bytes (BUFSIZ on macOS)
  using dir = tempDir("issue-28145", {
    "app.js": `
      const data = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: \`item-\${i}\`,
        description: \`This is a longer description for item number \${i} to ensure we exceed 8KB\`,
      }));
      console.log(JSON.stringify(data, null, 2));
    `,
  });

  // Compile the JS file into a standalone binary
  await using compile = Bun.spawn({
    cmd: [bunExe(), "build", "app.js", "--compile", "--outfile", "app-binary"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [compileStderr, compileExit] = await Promise.all([compile.stderr.text(), compile.exited]);
  expect(compileExit).toBe(0);

  // Run the compiled binary and capture stdout via pipe
  await using proc = Bun.spawn({
    cmd: [String(dir) + "/app-binary"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // The output should be valid JSON and contain all 500 items
  const parsed = JSON.parse(stdout);
  expect(parsed).toHaveLength(500);

  // Verify the output is significantly larger than 8192 bytes (the truncation point)
  expect(stdout.length).toBeGreaterThan(8192);
});
