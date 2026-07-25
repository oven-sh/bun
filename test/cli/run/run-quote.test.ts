import { expect, it } from "bun:test";
import { bunEnv, bunExe, bunRunAsScript, tempDir, tempDirWithFiles } from "harness";

it("should handle quote escapes", () => {
  const package_json = JSON.stringify({
    scripts: {
      test: `echo "test\\\\$(pwd)"`,
    },
  });
  expect(package_json).toContain('\\"');
  expect(package_json).toContain("\\\\");
  const dir = tempDirWithFiles("run-quote", { "package.json": package_json });
  const { stdout } = bunRunAsScript(dir, "test");
  expect(stdout).toBe(`test\\${dir}`);
});

it("keeps pass-through arguments containing tabs and question marks as single words", async () => {
  const dir = tempDirWithFiles("run-quote-passthrough", {
    "package.json": JSON.stringify({
      scripts: {
        args: `${bunExe()} print-args.js`,
      },
    }),
    "print-args.js": "console.log(JSON.stringify(process.argv.slice(2)));",
    "aXb": "",
  });
  const passthrough = ["a\tb", "a?b", "c\rd"];
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "args", "--", ...passthrough],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe(JSON.stringify(passthrough) + "\n");
  expect(exitCode).toBe(0);
});

// Positional arguments appended to a package.json script are joined into the
// script string, so an empty one must be emitted as a quoted empty word (`""`).
// Dropping it shifts every following positional left by one.
const argvEchoFixture = {
  "package.json": JSON.stringify({ name: "run-empty-arg", version: "1.0.0", scripts: { p: "bun args.js" } }),
  "args.js": "console.log(JSON.stringify(process.argv.slice(2)));",
};

it.concurrent.each([
  ["bun run <script>", ["run", "p"]],
  ["bun run <script> --", ["run", "p", "--"]],
  ["bun <script>", ["p"]],
])("preserves empty passthrough arguments (%s)", async (_label, prefix) => {
  using dir = tempDir("run-empty-arg", argvEchoFixture);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...prefix, "a", "", "b"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(stdout.trim()).toBe('["a","","b"]');
  expect(exitCode).toBe(0);
});

it.concurrent("preserves empty passthrough arguments (bun --filter)", async () => {
  using dir = tempDir("run-empty-arg-filter", argvEchoFixture);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--filter", "*", "p", "a", "", "b"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  // `--filter` prefixes each output line with "<package> <script>: ".
  expect(stdout).toContain('["a","","b"]');
  expect(exitCode).toBe(0);
});
