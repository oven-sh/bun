import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/26075
// server.reload() with HMR breaks bundler on second request when workspace
// packages are resolved through directory symlinks.

function setupMonorepo() {
  const dir = tempDirWithFiles("server-reload-hmr-workspace", {
    "packages/shared/package.json": JSON.stringify({
      name: "@test/shared",
      version: "1.0.0",
      main: "index.ts",
    }),
    "packages/shared/index.ts": `export const APP_NAME = "Test App";
export const VERSION = "1.0.0";`,
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

const server = Bun.serve({
  port: 0,
  development: true,
  routes: {
    "/health": () => Response.json({ status: "starting" }),
  },
  fetch: () => new Response("Starting...", { status: 503 }),
});

server.reload({
  development: { hmr: true },
  routes: {
    "/": homepage,
    "/health": () => Response.json({ status: "ok", app: APP_NAME }),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

writeFileSync(process.env.PORT_FILE!, String(server.port));`,
  });

  // Create workspace-style directory symlinks — the bug trigger.
  mkdirSync(join(dir, "node_modules", "@test"), { recursive: true });
  symlinkSync(join(dir, "packages", "shared"), join(dir, "node_modules", "@test", "shared"));

  return dir;
}

async function getPortFromStartedServer(serverProc: ReturnType<typeof Bun.spawn>, portFile: string): Promise<number> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    // Fail fast if the server process already exited
    const raceResult = await Promise.race([
      serverProc.exited.then(() => "exited" as const),
      Bun.sleep(50).then(() => "timeout" as const),
    ]);
    if (raceResult === "exited") {
      const stderr = await new Response(serverProc.stderr).text();
      const stdout = await new Response(serverProc.stdout).text();
      throw new Error(`Server process exited early. stdout: ${stdout}, stderr: ${stderr}`);
    }
    if (existsSync(portFile)) {
      const content = readFileSync(portFile, "utf8").trim();
      const parsed = parseInt(content, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  const stderr = await new Response(serverProc.stderr).text();
  const stdout = await new Response(serverProc.stdout).text();
  throw new Error(`Server failed to start. stdout: ${stdout}, stderr: ${stderr}`);
}

for (const flag of ["--hot", "--watch"]) {
  test(`server.reload() with html bundle and ${flag} should handle workspace packages on multiple requests`, async () => {
    const dir = setupMonorepo();
    const portFile = join(dir, ".port");

    await using serverProc = Bun.spawn({
      cmd: [bunExe(), flag, join(dir, "packages/app/server.ts")],
      cwd: join(dir, "packages/app"),
      env: { ...bunEnv, PORT_FILE: portFile },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const port = await getPortFromStartedServer(serverProc, portFile);
    const baseUrl = `http://localhost:${port}`;

    // First request — bundles the HTML route
    const res1 = await fetch(baseUrl);
    expect(res1.status).toBe(200);
    const html1 = await res1.text();
    expect(html1).toContain("<html");

    // Second request — before the fix, stale FD caused EBADF here
    const res2 = await fetch(baseUrl);
    expect(res2.status).toBe(200);
    const html2 = await res2.text();
    expect(html2).toContain("<html");

    // Third request — stability check
    const res3 = await fetch(baseUrl);
    expect(res3.status).toBe(200);

    // Health endpoint — uses shared module on server side
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ status: "ok", app: "Test App" });
  });
}
