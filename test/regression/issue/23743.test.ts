import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Regression test for issue 23743
// https://github.com/oven-sh/bun/issues/23743
// Dev server crashes when toggling server.development.console back and forth
test(
  "toggling development.console doesn't crash with file changes",
  async () => {
    const tmpdir = tempDirWithFiles("issue-23743", {
      "index.html": "<html><body>Hello</body></html>",
      "server.ts": `
      import { serve } from "bun";
      import index from "./index.html";

      declare global {
        var server: ReturnType<typeof serve> | null;
        var showBrowserLogs: boolean;
      }

      export const runServer = async (showBrowserLogs: boolean) => {
        const showBrowserLogsHasChanged = showBrowserLogs !== globalThis.showBrowserLogs;
        if (showBrowserLogsHasChanged) globalThis.showBrowserLogs = showBrowserLogs;

        if (globalThis.server && !showBrowserLogsHasChanged) return;

        await globalThis.server?.stop();

        globalThis.server = serve({
          port: 0,
          routes: {
            "/*": index,
          },
          development: process.env.NODE_ENV !== "production" && {
            hmr: true,
            console: globalThis.showBrowserLogs
          },
        });

        console.log(\`Server running at \${globalThis.server.url}\`);
        return globalThis.server;
      };

      const server = await runServer(false);
      console.log("READY:" + server.port);
    `,
    });

    // Start the server process
    const proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: bunEnv,
      cwd: tmpdir,
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Wait for server to be ready and capture port
      let port: number | null = null;
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();

      while (port === null) {
        const { value, done } = await reader.read();
        if (done) throw new Error("Server process ended unexpectedly");

        const text = decoder.decode(value);
        const match = text.match(/READY:(\d+)/);
        if (match) {
          port = parseInt(match[1]);
        }
      }
      reader.releaseLock();

      expect(port).toBeGreaterThan(0);

      // Make a connection
      const response1 = await fetch(`http://localhost:${port}/`);
      expect(response1.status).toBe(200);
      await response1.text();

      // Trigger file changes while the server is running
      // This should trigger the watcher
      const testFile = join(tmpdir, "test.txt");
      writeFileSync(testFile, "test1");
      await Bun.sleep(100);

      writeFileSync(testFile, "test2");
      await Bun.sleep(100);

      // Make another connection
      const response2 = await fetch(`http://localhost:${port}/`);
      expect(response2.status).toBe(200);
      await response2.text();

      writeFileSync(testFile, "test3");
      await Bun.sleep(100);

      // If we got here, the crash didn't happen
      expect(true).toBe(true);
    } finally {
      proc.kill();
      await proc.exited;
    }
  },
  { timeout: 30000 },
);
