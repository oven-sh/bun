import { bunExe } from "harness";

it("console.trace", async () => {
  const { stdout, stderr, exitCode } = await Bun.$`${bunExe()} -e "console.trace('hello')"`.quiet();
  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBeEmpty();
  const stderr_string = stderr.toString("utf8");
  expect(stderr_string).toStartWith("Trace: hello\n");
});
