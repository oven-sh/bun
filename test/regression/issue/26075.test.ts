import { expect, test } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/26075
// server.reload() with HMR breaks bundler on second request in monorepo workspaces
//
// The bug occurs when:
// - Monorepo with workspaces
// - Workspace package imported by both server and client code
// - server.reload() used to enable HMR
// - Multiple requests trigger re-bundling
//
// The root cause is stale file descriptors in the bundler's cache.
// After the first bundle, file descriptors are cached but then closed.
// On the second request, the cached (now-closed) FDs are reused,
// causing seekTo(0) to fail with "Unseekable" error.

test("server.reload() with HMR should handle workspace packages on multiple requests", async () => {
  const portFile = `/tmp/bun-test-26075-${Date.now()}-${Math.random().toString(36).slice(2)}.port`;

  const dir = tempDirWithFiles("server-reload-hmr-workspace", {
    "package.json": JSON.stringify({
      name: "monorepo-root",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/shared/package.json": JSON.stringify({
      name: "@test/shared",
      version: "1.0.0",
      main: "index.ts",
    }),
    "packages/shared/index.ts": `export const APP_NAME = "Test App";
export const VERSION = "1.0.0";`,
    "packages/app/package.json": JSON.stringify({
      name: "@test/app",
      version: "1.0.0",
      dependencies: {
        "@test/shared": "workspace:*",
      },
    }),
    "packages/app/index.html": `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
<div id="root"></div>
<script type="module" src="./main.ts"></script>
</body>
</html>`,
    "packages/app/main.ts": `import { APP_NAME, VERSION } from "@test/shared";
document.getElementById("root")!.textContent = APP_NAME + " v" + VERSION;`,
    "packages/app/server.ts": `import homepage from "./index.html";
import { APP_NAME } from "@test/shared";
import { writeFileSync } from "fs";

// Start server without HMR first (simulating staged initialization)
const server = Bun.serve({
  port: 0,
  development: true,
  routes: {
    "/health": () => Response.json({ status: "starting" }),
  },
  fetch: () => new Response("Starting...", { status: 503 }),
});

// Simulate async initialization delay
await Bun.sleep(10);

// Reload with HMR enabled and HTML routes
server.reload({
  development: { hmr: true },
  routes: {
    "/": homepage,
    "/health": () => Response.json({ status: "ok", app: APP_NAME }),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

// Write port to file for test to read
writeFileSync(process.env.PORT_FILE!, String(server.port));

// Keep server running
await Bun.sleep(30000);
server.stop(true);`,
  });

  // Install dependencies to create workspace links
  const installProc = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (installProc.exitCode !== 0) {
    throw new Error(`bun install failed: ${installProc.stderr.toString()}`);
  }

  // Start the server with --hot flag to trigger the HMR behavior
  const serverProc = Bun.spawn({
    cmd: [bunExe(), "--hot", join(dir, "packages/app/server.ts")],
    cwd: join(dir, "packages/app"),
    env: { ...bunEnv, PORT_FILE: portFile },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    // Wait for port file to be written
    let port: number | null = null;
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
      if (existsSync(portFile)) {
        const content = readFileSync(portFile, "utf8").trim();
        const parsed = parseInt(content, 10);
        if (!isNaN(parsed) && parsed > 0) {
          port = parsed;
          break;
        }
      }
      await Bun.sleep(50);
    }

    if (!port) {
      const stderr = await new Response(serverProc.stderr).text();
      const stdout = await new Response(serverProc.stdout).text();
      throw new Error(`Server failed to start. stdout: ${stdout}, stderr: ${stderr}`);
    }

    const baseUrl = `http://localhost:${port}`;

    // First request - should succeed and bundle the HTML
    const res1 = await fetch(baseUrl);
    expect(res1.status).toBe(200);
    const html1 = await res1.text();
    expect(html1).toContain("<html");

    // Second request - this is where the bug manifests
    // Before the fix: "Unseekable reading file" or "Unexpected reading file" error
    // After the fix: should succeed
    const res2 = await fetch(baseUrl);
    expect(res2.status).toBe(200);
    const html2 = await res2.text();
    expect(html2).toContain("<html");

    // Third request to ensure stability
    const res3 = await fetch(baseUrl);
    expect(res3.status).toBe(200);

    // Verify the health endpoint also works (uses shared module on server side)
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);
    const healthData = await healthRes.json();
    expect(healthData.status).toBe("ok");
    expect(healthData.app).toBe("Test App");
  } finally {
    // Clean up
    serverProc.kill();
    await serverProc.exited;
    try {
      unlinkSync(portFile);
    } catch {}
  }
}, 60000);
