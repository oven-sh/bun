import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

describe("hosted-git-info boundary conditions", () => {
  test.each([{ description: "git with pound", dependency: "https://github.com/#" }])(
    "handle $description",
    async ({ description: _, dependency }) => {
      using dir = tempDir("hosted-git-info-empty", {
        "package.json": JSON.stringify({
          name: "test",
          dependencies: {
            dependency,
          },
        }),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).not.toContain("panic");
    },
  );

  // A shortcut with nothing after the colon parses to an empty user, project and committish.
  // The expected output is what a release build prints for these specs.
  describe("shortcut with nothing after the colon", () => {
    async function install(files: Record<string, string>, env: Record<string, string> = {}) {
      using dir = tempDir("hosted-git-info-empty-shortcut", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"), ...env },
        stderr: "pipe",
        stdout: "ignore",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    }

    // No package has the name "zz", so the override applies to nothing and the install is empty.
    test.concurrent.each(["github:", "gitlab:", "bitbucket:", "gist:", "sourcehut:"])(
      "override value %s",
      async shortcut => {
        const { stderr, exitCode } = await install({
          "package.json": JSON.stringify({ name: "app", version: "1.0.0", overrides: { zz: shortcut } }),
        });

        expect(stderr).toContain("No packages! Deleted empty lockfile");
        expect(exitCode).toBe(0);
      },
    );

    test.concurrent("override value github: that bun.lock also has", async () => {
      const { stderr, exitCode } = await install({
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", overrides: { zz: "github:" } }),
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          workspaces: { "": { name: "app" } },
          overrides: { zz: "github:" },
          packages: {},
        }),
      });

      expect(stderr).toContain("No packages! Deleted empty lockfile");
      expect(exitCode).toBe(0);
    });

    test.concurrent("resolutions value github:", async () => {
      const { stderr, exitCode } = await install({
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", resolutions: { zz: "github:" } }),
      });

      expect(stderr).toContain("No packages! Deleted empty lockfile");
      expect(exitCode).toBe(0);
    });

    test.concurrent("version range github: in an override key", async () => {
      const { stderr, exitCode } = await install({
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", overrides: { "zz@github:": "1.0.0" } }),
      });

      expect(stderr).toContain('warn: Invalid version range "github:" for "zz"');
      expect(stderr).toContain("No packages! Deleted empty lockfile");
      expect(exitCode).toBe(0);
    });

    test.concurrent("dependency github:", async () => {
      const requests: string[] = [];
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          requests.push(new URL(req.url).pathname);
          return new Response("Not Found", { status: 404 });
        },
      });

      const { stderr, exitCode } = await install(
        { "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { zz: "github:" } }) },
        { GITHUB_API_URL: `http://localhost:${server.port}` },
      );

      expect(stderr).toContain(`error: GET http://localhost:${server.port}/repos//tarball/ - 404`);
      expect(requests).toEqual(["/repos//tarball/"]);
      expect(exitCode).toBe(1);
    });
  });
});
