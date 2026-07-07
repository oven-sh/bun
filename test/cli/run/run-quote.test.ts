import { expect, it } from "bun:test";
import { bunEnv, bunExe, bunRunAsScript, tempDirWithFiles } from "harness";

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
