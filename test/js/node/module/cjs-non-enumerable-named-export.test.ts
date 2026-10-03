import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("ESM imports non-enumerable CommonJS exports when another export is a getter", async () => {
  using dir = tempDir("cjs-non-enumerable-export", {
    "package.json": '{"type":"module"}',
    "nested/package.json": '{"type":"commonjs"}',
    "nested/dep.js": `
      Object.defineProperty(exports, "__esModule", { value: true });
      Object.defineProperty(exports, "hidden", { value: 17 });
      Object.defineProperty(exports, "broken", {
        enumerable: true,
        get() { throw new Error("unrelated getter"); },
      });
    `,
    "entry.mjs": `
      import { hidden } from "./nested/dep.js";
      console.log(hidden);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("17");
  expect(exitCode).toBe(0);
});
