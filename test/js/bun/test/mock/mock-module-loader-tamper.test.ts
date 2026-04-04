import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Filter out ASAN warnings that only appear in debug builds
function filterAsanWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN"))
    .join("\n")
    .trim();
}

test("mock.module does not crash when globalThis.Loader is tampered", async () => {
  // Test 1: Loader set to non-object truthy value
  await using proc1 = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `globalThis.Loader = true; Bun.jest().mock.module("test-mod", () => ({ foo: 1 })); console.log("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout1, stderr1, exit1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  expect(filterAsanWarning(stderr1)).toBe("");
  expect(stdout1).toBe("ok\n");
  expect(exit1).toBe(0);

  // Test 2: Loader deleted
  await using proc2 = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `delete globalThis.Loader; Bun.jest().mock.module("test-mod", () => ({ bar: 2 })); console.log("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exit2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(filterAsanWarning(stderr2)).toBe("");
  expect(stdout2).toBe("ok\n");
  expect(exit2).toBe(0);
});
