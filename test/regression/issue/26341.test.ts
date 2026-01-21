/**
 * Regression test for https://github.com/oven-sh/bun/issues/26341
 *
 * When using `linker = "isolated"` and a tarball download fails (e.g., 401 Unauthorized),
 * `bun install` should fail with an error message instead of hanging forever.
 */
import { spawn } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { writeFile } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
import { join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  setContextHandler,
} from "../../cli/install/dummy.registry";

beforeAll(dummyBeforeAll);

afterAll(dummyAfterAll);

test("isolated install does not hang on 401 tarball download error", async () => {
  const ctx = await createTestContext({ linker: "isolated" });
  try {
    // Set up a handler that returns 401 for tarball downloads
    setContextHandler(ctx, async request => {
      const url = request.url;
      if (url.endsWith(".tgz")) {
        // Simulate 401 Unauthorized for tarball download
        return new Response("Unauthorized", { status: 401 });
      }
      // Return valid manifest for package resolution
      const name = "test-pkg";
      return new Response(
        JSON.stringify({
          name,
          versions: {
            "1.0.0": {
              name,
              version: "1.0.0",
              dist: {
                tarball: `${ctx.registry_url}${name}-1.0.0.tgz`,
              },
            },
          },
          "dist-tags": {
            latest: "1.0.0",
          },
        }),
      );
    });

    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          "test-pkg": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    // The test should complete (not hang) and exit with non-zero code
    const exitCode = await exited;
    const errText = await stderr.text();

    // Should have error output about the 401
    expect(errText).toContain("401");

    // Should exit with error code
    expect(exitCode).not.toBe(0);
  } finally {
    destroyTestContext(ctx);
  }
});

test("isolated install does not hang on 403 tarball download error", async () => {
  const ctx = await createTestContext({ linker: "isolated" });
  try {
    // Set up a handler that returns 403 for tarball downloads
    setContextHandler(ctx, async request => {
      const url = request.url;
      if (url.endsWith(".tgz")) {
        return new Response("Forbidden", { status: 403 });
      }
      const name = "test-pkg";
      return new Response(
        JSON.stringify({
          name,
          versions: {
            "1.0.0": {
              name,
              version: "1.0.0",
              dist: {
                tarball: `${ctx.registry_url}${name}-1.0.0.tgz`,
              },
            },
          },
          "dist-tags": {
            latest: "1.0.0",
          },
        }),
      );
    });

    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          "test-pkg": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const exitCode = await exited;
    const errText = await stderr.text();

    expect(errText).toContain("403");
    expect(exitCode).not.toBe(0);
  } finally {
    destroyTestContext(ctx);
  }
});

test("isolated install does not hang on 404 tarball download error", async () => {
  const ctx = await createTestContext({ linker: "isolated" });
  try {
    // Set up a handler that returns 404 for tarball downloads
    setContextHandler(ctx, async request => {
      const url = request.url;
      if (url.endsWith(".tgz")) {
        return new Response("Not Found", { status: 404 });
      }
      const name = "test-pkg";
      return new Response(
        JSON.stringify({
          name,
          versions: {
            "1.0.0": {
              name,
              version: "1.0.0",
              dist: {
                tarball: `${ctx.registry_url}${name}-1.0.0.tgz`,
              },
            },
          },
          "dist-tags": {
            latest: "1.0.0",
          },
        }),
      );
    });

    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          "test-pkg": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const exitCode = await exited;
    const errText = await stderr.text();

    expect(errText).toContain("404");
    expect(exitCode).not.toBe(0);
  } finally {
    destroyTestContext(ctx);
  }
});
