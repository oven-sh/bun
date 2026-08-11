import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/15276
test("parsing npm aliases without package manager does not crash", async () => {
  // Easiest way to repro this regression is `bunx bunbunbunbunbun@npm:another-bun@1.0.0`. The package
  // doesn't need to exist, we just need `bunx` to parse the package version, so the registry is a local
  // server that has nothing.
  const requests: string[] = [];
  await using registry = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "x", "bunbunbunbunbun@npm:another-bun@1.0.0"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, npm_config_registry: `http://127.0.0.1:${registry.port}/` },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("error: bunbunbunbunbun@npm:another-bun@1.0.0 failed to resolve");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
  // The alias was parsed: it is the alias target that gets looked up.
  expect([...new Set(requests)]).toEqual(["/another-bun"]);
});
