import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// mock.module() of a module nothing has loaded, with a factory whose object is marked `__esModule` and has a `default`:
// require() got that `default` alone, so the named exports were gone. 1.2.1 returned the factory's object, 1.2.2 broke it.
test("require() of a mock marked __esModule keeps the factory's named exports", async () => {
  using dir = tempDir("issue-48137", {
    "fixtures/unloaded-mixed.js": `
      export const named = 1;
      export default { sentinel: 1 };
    `,
    "repro.test.js": `
      import { expect, mock, test } from "bun:test";

      test("mocking a mixed module retains named exports for CommonJS consumers", () => {
        const exports = { __esModule: true, default: {}, named: 2 };
        mock.module("./fixtures/unloaded-mixed.js", () => exports);
        const required = require("./fixtures/unloaded-mixed.js");
        expect(required.named).toBe(2);
        expect(required).toBe(exports);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./repro.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 1 pass\n 0 fail\n");
  expect(exitCode).toBe(0);
});
