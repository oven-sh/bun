import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// terminate() landing inside one long BigInt division. JSC runs the division in
// C++ and polls for the termination request from the division loop, at the top
// of a quotient row. It must leave from there although the remainder is not
// reduced yet. JSBigInt::divideSchoolbook shifted that half-reduced value into
// the shorter remainder buffer, and a RELEASE_ASSERT on the sizes aborted the
// whole process (oven-sh/WebKit#655).
//
// After 'ready' the worker never returns to its event loop: the next statement
// is the division loop, so terminate() cannot find an idle worker. The worker
// repeats the division, so the request lands inside one however late it is.
// A digit is 64 bits.
test.concurrent.each([
  ["x % y, y has 55 digits (schoolbook division)", "%", "(1n << 3500n) - 987654321987654321n"],
  // The low half of y is zero, so the multiplication in each Burnikel-Ziegler
  // step counts no work and every poll is in a row of the schoolbook base case.
  ["x / y, y has 112 digits (Burnikel-Ziegler base case)", "/", "((1n << 3584n) - 987654321987654321n) << 3584n"],
])("worker.terminate() during BigInt %s", async (_, operator, divisor) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const src = "const x = (1n << BigInt(2 ** 28)) - 12345678901234567891n; const y = ${divisor};" +
         "postMessage('ready'); for (;;) x ${operator} y;";
       const w = new Worker(URL.createObjectURL(new Blob([src])));
       const closed = new Promise(res => w.addEventListener("close", res));
       await new Promise(res => (w.onmessage = res));
       w.terminate();
       await closed;
       console.log("PASS");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("PASS\n");
  expect(exitCode).toBe(0);
});
