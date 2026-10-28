import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("failing matcher on FormData without a callable toJSON does not abort the test runner", async () => {
  using dir = tempDir("formdata-tojson-crash", {
    "formdata.test.ts": `
      import { test, expect } from "bun:test";

      test("toJSON shadowed with undefined", () => {
        const fd = new FormData();
        Object.defineProperty(fd, "toJSON", { value: undefined });
        expect(fd).toEqual(1 as any);
      });

      test("null prototype", () => {
        const fd = new FormData();
        fd.append("a", "b");
        Object.setPrototypeOf(fd, null);
        expect(fd).toEqual(1 as any);
      });

      test("toJSON is a non-callable value", () => {
        const fd = new FormData();
        fd.append("a", "b");
        Object.defineProperty(fd, "toJSON", { value: 42 });
        expect(fd).toEqual(1 as any);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "formdata.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Received: FormData");
  // The non-callable toJSON is printed as a property rather than being called.
  expect(stderr).toContain(`"toJSON": 42`);
  expect(stderr).not.toContain("is not a function");
  expect(stderr).toContain("3 fail");
  expect(exitCode).toBe(1);
});
