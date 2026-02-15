import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, gunzipJsonRequest, tempDir } from "harness";

// Test for GitHub issue #26675:
// `bun audit --prod` should not include devDependencies of workspace packages

let server: Bun.Server;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async req => {
      const body = await gunzipJsonRequest(req);

      // Return vulnerabilities for ms@0.7.0, empty for everything else
      if (body && body.ms && body.ms.includes("0.7.0")) {
        return Response.json({
          ms: [
            {
              id: 1094419,
              url: "https://github.com/advisories/GHSA-w9mr-4mfr-499f",
              title: "Vercel ms Inefficient Regular Expression Complexity vulnerability",
              severity: "moderate",
              vulnerable_versions: "<2.0.0",
            },
          ],
        });
      }

      return Response.json({});
    },
  });
});

afterAll(() => {
  server.stop();
});

const fakeIntegrity = "sha512-V8E0l1jyyeSSS9R+J9oljx5eq2rqzClInuwaPcyuv0Mm3ViI/3/rcc4rCEO8i4eQ4I0O0FAGYDA2i5xWHHPhzg==";

describe("issue #26675 - bun audit --prod with workspace devDependencies", () => {
  test("--prod flag should exclude devDependencies of workspace packages", async () => {
    using dir = tempDir("bun-test-audit-workspace-prod", {
      "package.json": JSON.stringify({
        name: "test-monorepo",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/frontend/package.json": JSON.stringify({
        name: "test-frontend",
        devDependencies: {
          ms: "0.7.0",
        },
      }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "test-monorepo",
          },
          "packages/frontend": {
            name: "test-frontend",
            devDependencies: {
              ms: "0.7.0",
            },
          },
        },
        packages: {
          "test-frontend": ["test-frontend@workspace:packages/frontend"],
          ms: ["ms@0.7.0", "", {}, fakeIntegrity],
        },
      }),
    });

    const url = server.url.toString().slice(0, -1);

    // First, verify that without --prod, the vulnerability is reported
    {
      await using proc = spawn({
        cmd: [bunExe(), "audit"],
        stdout: "pipe",
        stderr: "pipe",
        cwd: String(dir),
        env: {
          ...bunEnv,
          NPM_CONFIG_REGISTRY: url,
        },
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toContain("ms");
      expect(stdout).toContain("vulnerabilities");
      expect(exitCode).toBe(1);
    }

    // Now verify that with --prod, the devDependency vulnerability is NOT reported
    {
      await using proc = spawn({
        cmd: [bunExe(), "audit", "--prod"],
        stdout: "pipe",
        stderr: "pipe",
        cwd: String(dir),
        env: {
          ...bunEnv,
          NPM_CONFIG_REGISTRY: url,
        },
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toContain("No vulnerabilities found");
      expect(exitCode).toBe(0);
    }
  });

  test("--prod flag should still report production dependencies of workspace packages", async () => {
    using dir = tempDir("bun-test-audit-workspace-prod-deps", {
      "package.json": JSON.stringify({
        name: "test-monorepo",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/frontend/package.json": JSON.stringify({
        name: "test-frontend",
        dependencies: {
          ms: "0.7.0",
        },
      }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "test-monorepo",
          },
          "packages/frontend": {
            name: "test-frontend",
            dependencies: {
              ms: "0.7.0",
            },
          },
        },
        packages: {
          "test-frontend": ["test-frontend@workspace:packages/frontend"],
          ms: ["ms@0.7.0", "", {}, fakeIntegrity],
        },
      }),
    });

    const url = server.url.toString().slice(0, -1);

    // With --prod, production dependency vulnerabilities should still be reported
    await using proc = spawn({
      cmd: [bunExe(), "audit", "--prod"],
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: url,
      },
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("ms");
    expect(stdout).toContain("vulnerabilities");
    expect(exitCode).toBe(1);
  });
});
