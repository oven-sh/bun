import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

// toMatchObject and Bun.deepMatch recurse natively into nested objects. A
// chain deeper than the native stack must throw RangeError, not segfault.
test.concurrent.each([
  ["expect().toMatchObject()", "Bun.jest().expect(ra).toMatchObject(rb)"],
  ["Bun.deepMatch()", "Bun.deepMatch(rb, ra)"],
])("%s throws RangeError on deeply nested objects instead of crashing", async (_, compare) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let a = {}, b = {};
const ra = a, rb = b;
for (let i = 0; i < 100000; i++) { a.x = {}; b.x = {}; a = a.x; b = b.x; }
try {
  ${compare};
  console.log("no throw");
} catch (e) {
  console.log(e instanceof RangeError, e.message);
}`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("true Maximum call stack size exceeded.\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// The failure printer and the snapshot serializer recurse natively into the
// value. A chain deeper than the native stack must throw RangeError, not
// segfault.
test.concurrent.each([
  ["expect().toEqual()", "Bun.jest().expect(ra).toEqual(rb)"],
  ["expect().toStrictEqual()", "Bun.jest().expect(ra).toStrictEqual(rb)"],
])("%s failure message throws RangeError on deeply nested objects instead of crashing", async (_, compare) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let a = {}, b = {};
const ra = a, rb = b;
for (let i = 0; i < 10000; i++) { a.x = {}; b.x = {}; a = a.x; b = b.x; }
b.y = 1;
try {
  ${compare};
  console.log("no throw");
} catch (e) {
  console.log(e instanceof RangeError, e.message);
}`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("true Maximum call stack size exceeded.\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("toMatchSnapshot throws RangeError on deeply nested objects instead of crashing", async () => {
  using dir = tempDir("deep-snapshot", {
    "deep.test.ts": `import { test, expect } from "bun:test";
test("deep", () => {
  let a = {};
  const ra = a;
  for (let i = 0; i < 10000; i++) { a.x = {}; a = a.x; }
  expect(ra).toMatchSnapshot();
});`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "deep.test.ts"],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("RangeError: Maximum call stack size exceeded.");
  expect(stderr).toContain("(fail) deep");
  expect(exitCode).toBe(1);
});
