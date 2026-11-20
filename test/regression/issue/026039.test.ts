import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for https://github.com/oven-sh/bun/issues/26039
// When parsing a bun.lock file with an empty registry URL for a scoped package,
// bun should use the scope-specific registry from bunfig.toml, not the default registry.
//
// One local server stands in for both registries: `/scoped/` is the registry
// configured for the @example scope and `/default/` is the default registry.
// Neither has the package, so the install fails either way; what matters is
// which of the two the tarball was requested from.
async function frozenInstall(name: string, packageName: string) {
  const requests: string[] = [];
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });
  const registry = `http://127.0.0.1:${server.port}`;

  await using dir = tempDir(name, {
    "package.json": JSON.stringify({
      name,
      version: "1.0.0",
      dependencies: {
        [packageName]: "^1.0.0",
      },
    }),
    "bunfig.toml": `
[install]
cache = false
registry = "${registry}/default/"

[install.scopes]
example = { url = "${registry}/scoped/" }
`,
    // bun.lock with an empty string for the registry URL - this is what triggers the scope lookup
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: {
          "": {
            dependencies: {
              [packageName]: "^1.0.0",
            },
          },
        },
        packages: {
          [packageName]: [`${packageName}@1.0.0`, "", {}, "sha512-AAAA"],
        },
      },
      null,
      2,
    ),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { registry, requests: [...new Set(requests)], stdout, stderr, exitCode };
}

test.concurrent("frozen lockfile should use scope-specific registry for scoped packages", async () => {
  const { registry, requests, stderr, exitCode } = await frozenInstall("scoped-registry-test", "@example/test-package");

  // Before the fix this was requested from the default registry instead.
  expect(requests).toEqual(["/scoped/@example/test-package/-/test-package-1.0.0.tgz"]);
  expect(stderr).toContain(`${registry}/scoped/@example/test-package/-/test-package-1.0.0.tgz`);
  expect(stderr).not.toContain("/default/");
  // The install should fail because the package doesn't exist on the registry
  expect(exitCode).not.toBe(0);
});

// Test that non-scoped packages still use the default registry when registry URL is empty
test.concurrent("frozen lockfile should use default registry for non-scoped packages", async () => {
  const { registry, requests, stderr, exitCode } = await frozenInstall(
    "non-scoped-registry-test",
    "fake-nonexistent-package",
  );

  expect(requests).toEqual(["/default/fake-nonexistent-package/-/fake-nonexistent-package-1.0.0.tgz"]);
  expect(stderr).toContain(`${registry}/default/fake-nonexistent-package/-/fake-nonexistent-package-1.0.0.tgz`);
  expect(stderr).not.toContain("/scoped/");
  // The install should fail because the package doesn't exist on the registry
  expect(exitCode).not.toBe(0);
});
