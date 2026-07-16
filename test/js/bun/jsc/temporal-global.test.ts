import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Upstream WebKit c8b6308aaa69 ships Temporal enabled by default
// (https://bugs.webkit.org/show_bug.cgi?id=318234). Before this
// WebKit bump the global was only reachable with --useTemporal=1.
test("Temporal is exposed on the global object", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(typeof Temporal + " " + typeof Temporal.Now.instant)`],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "object function", stderr: expect.any(String), exitCode: 0 });
});

test("Temporal.Now.instant returns a Temporal.Instant", () => {
  // @ts-expect-error: Temporal types land with the WebKit bump
  const instant = Temporal.Now.instant();
  // @ts-expect-error
  expect(instant instanceof Temporal.Instant).toBe(true);
  expect(typeof instant.epochNanoseconds).toBe("bigint");
});
