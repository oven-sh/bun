import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("comma operator should strip 'this' binding in function calls", async () => {
  const dir = tempDirWithFiles("comma-operator-test", {
    "test.js": `
const doThing = () => {};

const cool = {
    value: "beans", 
    logValue() {
        console.log(this?.value || "undefined");
    }
}

// Direct call - should preserve 'this'
cool.logValue();

// Comma operator calls - should strip 'this' 
(0, cool.logValue)();
(doThing(), cool.logValue)();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Should output: beans, undefined, undefined
  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe("beans");
  expect(lines[1]).toBe("undefined");
  expect(lines[2]).toBe("undefined");
});
