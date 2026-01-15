import type { Server } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

/**
 * Test for GitHub issue #2766
 * When a tarball download fails (HTTP error or connection error), bun install
 * should exit with a non-zero exit code.
 */
describe("issue #2766 - tarball download failures should cause non-zero exit code", () => {
  let mockRegistry: Server;
  let mockRegistryUrl: string;

  beforeEach(async () => {
    mockRegistry = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        // Package metadata endpoint - always succeeds
        if (url.pathname === "/test-package-404") {
          return new Response(
            JSON.stringify({
              name: "test-package-404",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "test-package-404",
                  version: "1.0.0",
                  dist: {
                    tarball: `${mockRegistryUrl}/test-package-404/-/test-package-404-1.0.0.tgz`,
                    integrity: "sha512-invalidintegrity==",
                  },
                },
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        // Tarball endpoint - return 404 to simulate download failure
        if (url.pathname.endsWith(".tgz")) {
          return new Response("Not Found", { status: 404 });
        }

        return new Response("Not found", { status: 404 });
      },
    });

    mockRegistryUrl = `http://localhost:${mockRegistry.port}`;
  });

  afterEach(() => {
    mockRegistry?.stop();
  });

  test("bun install exits with non-zero code when tarball download returns 404", async () => {
    using dir = tempDir("issue-2766", {
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: {
          "test-package-404": "1.0.0",
        },
      }),
      "bunfig.toml": `
[install]
registry = "${mockRegistryUrl}/"
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should have error output about the failed tarball
    expect(stderr).toContain("404");
    // Must exit with non-zero code
    expect(exitCode).not.toBe(0);
  });
});
