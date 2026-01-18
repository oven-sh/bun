import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("Bun.version", () => {
  expect(process.versions.bun).toBe(Bun.version);
  expect(process.revision).toBe(Bun.revision);
});

test("expect().not.not", () => {
  // bun supports this but jest doesn't
  expect(1).not.not.toBe(1);
  expect(1).not.not.not.toBe(2);
});

// Regression test for #14624
test("uncaught promise rejection in async test should not hang", async () => {
  using dir = tempDir("issue-14624", {
    "hang.test.js": `
      import { test } from 'bun:test'

      test('async test with uncaught rejection', async () => {
        console.log('test start');
        // This creates an unhandled promise rejection
        (async () => { throw new Error('uncaught error'); })();
        await Bun.sleep(1);
        console.log('test end');
      })
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "hang.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set a timeout to detect if the process hangs
  let timeout = false;
  const timer = setTimeout(() => {
    timeout = true;
    proc.kill();
  }, 3000);

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  clearTimeout(timer);

  const output = stdout + stderr;

  expect(timeout).toBeFalse();
  expect(output).toContain("test start");
  // expect(output).toContain("test end"); // the process exits before this executes
  expect(output).toContain("uncaught error");
  expect(exitCode).not.toBe(0);
  expect(output).toMatch(/✗|\(fail\)/);
  expect(output).toMatch(/\n 1 fail/);
});

// Regression test for #19107
test.failing("throw undefined no crash", () => {
  expect(() => {
    throw undefined;
  }).toThrow(TypeError);
});

// Regression test for #20100
test("20100", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/20100.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    <top-level>
      <top-level-test> { unpredictableVar: "top level" } </top-level-test>
      <describe-1>
        <describe-1-test> { unpredictableVar: "describe 1" } </describe-1-test>
      </describe-1>
      <describe-2>
        <describe-2-test> { unpredictableVar: "describe 2" } </describe-2-test>
      </describe-2>
    </top-level>"
  `);
});

// Regression test for #21177
test("21177 - filter skips beforeAll when describe is filtered", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/21177.fixture.ts", "-t", "true is true"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun test <version> (<revision>)"`);
  expect(exitCode).toBe(0);
});

// Regression test for #21177
test("21177 - filter runs parent beforeAll hooks", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/21177.fixture-2.ts", "-t", "middle is middle"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    Running beforeAll in Outer describe
    Running beforeAll in Middle describe"
  `);
  expect(exitCode).toBe(0);
});
