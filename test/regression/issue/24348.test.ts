import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/24348
test("bundler replaces process.env even when 'process' is shadowed by a local variable", async () => {
  using dir = tempDir("issue-24348", {
    "main.js": `
const works = () => console.log("Works: " + process.env.TEST_PUBLIC_ENV);

const shouldAlsoWork = () => {
    const process = {
        env: {
            OTHER_VAR: "123"
        }
    }

    console.log("Should also work: " + process.env.TEST_PUBLIC_ENV);
};

works();
shouldAlsoWork();
`,
  });

  // Bundle the file with --env pattern matching
  await using bundleProc = Bun.spawn({
    cmd: [bunExe(), "build", "main.js", "--outfile", "out.js", "--env", "TEST_PUBLIC_*"],
    env: { ...bunEnv, TEST_PUBLIC_ENV: "replaced_value" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [bundleStdout, bundleStderr, bundleExitCode] = await Promise.all([
    bundleProc.stdout.text(),
    bundleProc.stderr.text(),
    bundleProc.exited,
  ]);

  expect(bundleStderr).toBe("");
  expect(bundleExitCode).toBe(0);

  // Read the bundled output
  const bundledCode = await Bun.file(`${dir}/out.js`).text();

  // Both occurrences should be replaced with the env value
  const matches = bundledCode.match(/"replaced_value"/g);
  expect(matches).not.toBeNull();
  expect(matches?.length).toBe(2);

  // Verify the original process.env.TEST_PUBLIC_ENV is not in the output
  expect(bundledCode).not.toContain("process.env.TEST_PUBLIC_ENV");

  // Run the bundled code to verify it works
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("Works: replaced_value");
  expect(stdout).toContain("Should also work: replaced_value");
  expect(exitCode).toBe(0);
});
