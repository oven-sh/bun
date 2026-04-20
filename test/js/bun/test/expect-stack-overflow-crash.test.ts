import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: calling expect matchers after catching a stack overflow
// should not crash with a releaseAssertNoException assertion failure.
test("expect does not crash when called after catching stack overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `var a=false,b=false;
function r(){r()}
try{r()}catch(e){a=true}
try{Bun.jest().expect(42).toBeFalse()}catch(e){b=true}
if(a&&b)console.log("OK")`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});
