import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for https://github.com/oven-sh/bun/issues/26075
// server.reload() with HMR breaks bundler on second request in monorepo workspaces.
// The error is "Unseekable reading file" for workspace package files.
describe("issue #26075", () => {
  test("server.reload() with HTML bundle does not fail on second request", async () => {
    // Create a temporary monorepo structure
    using dir = tempDir("issue-26075", {
      "package.json": JSON.stringify({
        name: "test-monorepo",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/shared/package.json": JSON.stringify({
        name: "@test/shared",
        version: "1.0.0",
        main: "index.ts",
      }),
      "packages/shared/index.ts": `
export const APP_NAME = "Test App";
export function formatMessage(msg: string): string {
  return \`[\${APP_NAME}] \${msg}\`;
}
      `.trim(),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        version: "1.0.0",
        dependencies: {
          "@test/shared": "workspace:*",
        },
      }),
      "packages/app/index.html": `
<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
      `.trim(),
      "packages/app/main.ts": `
import { APP_NAME, formatMessage } from "@test/shared";
console.log(formatMessage("Client loaded"));
document.body.innerHTML = "<h1>" + APP_NAME + "</h1>";
      `.trim(),
      "packages/app/server.ts": `
import { formatMessage } from "@test/shared";
import homepage from "./index.html";

// Phase 1: Initial bind with minimal routes
const server = Bun.serve({
  port: 0, // Use random port
  development: true,
  routes: {
    "/health": () => Response.json({ status: "starting" }, { status: 503 }),
  },
  fetch: () => new Response("Starting...", { status: 503 }),
});

console.log("PORT:" + server.port);

// Phase 2: Reload with HTML route (this triggers the bug)
server.reload({
  development: true,
  routes: {
    "/": homepage,
    "/health": () => Response.json({ status: "ok" }),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

console.log(formatMessage("Server ready"));

// Signal we're ready
console.log("READY");
      `.trim(),
    });

    // Install workspace dependencies
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await installProc.exited;

    // Start the server
    await using serverProc = Bun.spawn({
      cmd: [bunExe(), "run", "packages/app/server.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read server output to get port
    let output = "";
    let port: number | null = null;

    // Wait for server to be ready with timeout
    const deadline = Date.now() + 15000;
    for await (const chunk of serverProc.stdout) {
      output += new TextDecoder().decode(chunk);

      if (!port) {
        const portMatch = output.match(/PORT:(\d+)/);
        if (portMatch) {
          port = parseInt(portMatch[1], 10);
        }
      }

      if (output.includes("READY")) {
        break;
      }

      if (Date.now() > deadline) {
        throw new Error("Timeout waiting for server to be ready: " + output);
      }
    }

    expect(port).not.toBeNull();

    // Make first request - should succeed
    const response1 = await fetch(`http://localhost:${port}/`);
    expect(response1.status).toBe(200);
    const html1 = await response1.text();
    expect(html1).toContain("<!DOCTYPE html>");

    // Wait a short moment for any cleanup
    await Bun.sleep(100);

    // Make second request - this is where the bug manifests
    // Before the fix, this would fail with "Unseekable reading file"
    const response2 = await fetch(`http://localhost:${port}/`);
    expect(response2.status).toBe(200);
    const html2 = await response2.text();
    expect(html2).toContain("<!DOCTYPE html>");

    // Make third request to be thorough
    const response3 = await fetch(`http://localhost:${port}/`);
    expect(response3.status).toBe(200);

    // Kill the server process first
    serverProc.kill();

    // Then check stderr for errors
    const stderr = await new Response(serverProc.stderr).text();
    expect(stderr).not.toContain("Unseekable");
    expect(stderr).not.toContain("error:");
  }, 30000);
});
