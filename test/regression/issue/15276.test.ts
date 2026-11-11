import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("parsing npm aliases without package manager does not crash", async () => {
  // Easiest way to repro this regression with `bunx bunbunbunbunbun@npm:another-bun@1.0.0`. The package
  // doesn't need to exist, we just need `bunx` to parse the package version.
  using registry = Bun.serve({ port: 0, fetch: () => new Response("{}", { status: 404 }) });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "x", "bunbunbunbunbun@npm:another-bun@1.0.0"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, BUN_CONFIG_REGISTRY: registry.url.href },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The 404 fails the request, so it is the only error, as for `bunx another-bun@1.0.0`.
  expect(stderr).toContain(`error: GET ${registry.url.href}another-bun - 404`);
  expect(stderr).not.toContain("failed to resolve");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
