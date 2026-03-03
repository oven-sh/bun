import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27716
// bun install silently fails when a security scanner is configured and
// the project has enough packages that the inline JSON would exceed the
// OS per-argument size limit (MAX_ARG_STRLEN = 128KB on Linux).

const PACKAGE_COUNT = 850;
const tgzPath = join(import.meta.dir, "..", "..", "cli", "install", "bar-0.0.2.tgz");
const tgzData = readFileSync(tgzPath);

test("security scanner works with many packages", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path.endsWith(".tgz")) {
        return new Response(tgzData);
      }

      const registryUrl = `http://localhost:${server.port}/`;
      const name = decodeURIComponent(path.slice(1));
      return new Response(
        JSON.stringify({
          name,
          versions: {
            "1.0.0": {
              name,
              version: "1.0.0",
              dist: {
                tarball: `${registryUrl}${name}-1.0.0.tgz`,
              },
            },
          },
          "dist-tags": { latest: "1.0.0" },
        }),
      );
    },
  });

  const registryUrl = `http://localhost:${server.port}/`;

  using dir = tempDir("issue-27716", {
    "scanner.ts": `export const scanner = {
  version: "1",
  scan: async ({ packages }) => {
    return [];
  },
};`,
  });

  // Generate many dependencies
  const deps: Record<string, string> = {};
  for (let i = 0; i < PACKAGE_COUNT; i++) {
    deps[`pkg-with-a-longer-name-for-testing-${String(i).padStart(4, "0")}`] = "1.0.0";
  }

  await Bun.write(
    join(String(dir), "package.json"),
    JSON.stringify({ name: "test-27716", version: "1.0.0", dependencies: deps }),
  );

  await Bun.write(
    join(String(dir), "bunfig.toml"),
    `[install]\nregistry = "${registryUrl}"\n\n[install.security]\nscanner = "./scanner.ts"\n`,
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Security scanner failed");
  expect(existsSync(join(String(dir), "bun.lock"))).toBe(true);
  expect(existsSync(join(String(dir), "node_modules"))).toBe(true);
  expect(exitCode).toBe(0);
}, 60_000);
