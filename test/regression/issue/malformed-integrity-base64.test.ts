import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

test("malformed integrity base64 in lockfile should be handled gracefully", async () => {
  // Decodes to 100 bytes, larger than any digest bun supports (sha512 is 64 bytes).
  // Parsing this used to write past the end of the fixed-size digest buffer.
  const oversizedBase64 = Buffer.alloc(100, 0xaa).toString("base64");

  // The integrity string is parsed while bun.lock is loaded, and the lockfile
  // satisfies package.json, so the --dry-run below has nothing to resolve. The
  // registry only exists to prove that: it must never receive a request.
  const registryRequests: string[] = [];
  using registry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      registryRequests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  await using dir = tempDir("malformed-integrity-test", {
    "package.json": JSON.stringify({
      name: "test-malformed-integrity",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21",
      },
    }),
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "test-malformed-integrity",
            dependencies: {
              "lodash": "4.17.21",
            },
          },
        },
        packages: {
          "lodash": ["lodash@4.17.21", "", {}, `sha256-${oversizedBase64}`],
        },
      },
      null,
      2,
    ),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--dry-run"],
    cwd: dir,
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: registry.url.href,
      // The CI runner shares one cache between tests; a warm one could satisfy a
      // resolution without a registry request and hide it from the check below.
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

     lodash@4.17.21 done"
  `);
  const err = normalizeBunSnapshot(stderr, dir);
  expect(err).toContain("warn: Unsupported or malformed integrity hash; ignoring");
  expect(err).not.toContain("error:");
  expect(registryRequests).toEqual([]);
  expect(exitCode).toBe(0);
});
