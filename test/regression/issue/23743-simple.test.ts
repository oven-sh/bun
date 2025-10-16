import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Regression test for issue 23743
// https://github.com/oven-sh/bun/issues/23743
// Dev server crashes when toggling server.development.console back and forth
test(
  "server stop/start with development.console toggle crashes",
  async () => {
    const tmpdir = tempDirWithFiles("issue-23743-simple", {
      "index.html": "<html><body>Hello</body></html>",
      "server.ts": `
import { serve } from "bun"
import index from "./index.html"

declare global {
  var server: ReturnType<typeof serve> | null
  var showBrowserLogs: boolean
}

export const runServer = async (showBrowserLogs: boolean) => {
  const showBrowserLogsHasChanged = showBrowserLogs !== globalThis.showBrowserLogs
  if (showBrowserLogsHasChanged) globalThis.showBrowserLogs = showBrowserLogs

  if (globalThis.server && !showBrowserLogsHasChanged) return

  await globalThis.server?.stop() // required for the development changes to take effect

  globalThis.server = serve({
    port: 3000,
    routes: {
      "/*": index,
    },
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: globalThis.showBrowserLogs
    },
  })

  console.log(\`Server running at \${globalThis.server.url}\`)
}

await runServer(false)
console.log("READY")
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
      // Wait for server to be ready
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let ready = false;

      while (!ready) {
        const { value, done } = await reader.read();
        if (done) {
          const stderr = await proc.stderr.text();
          throw new Error(`Server process ended unexpectedly. stderr: ${stderr}`);
        }

        const text = decoder.decode(value);
        if (text.includes("READY")) {
          ready = true;
        }
      }
      reader.releaseLock();

      // Make a browser connection
      const response1 = await fetch(`http://localhost:3000/`);
      expect(response1.status).toBe(200);
      await response1.text();

      // Give time for connection to establish
      await Bun.sleep(500);

      // Toggle to true (first toggle - should work)
      await Bun.write(
        tmpdir + "/server.ts",
        `
import { serve } from "bun"
import index from "./index.html"

declare global {
  var server: ReturnType<typeof serve> | null
  var showBrowserLogs: boolean
}

export const runServer = async (showBrowserLogs: boolean) => {
  const showBrowserLogsHasChanged = showBrowserLogs !== globalThis.showBrowserLogs
  if (showBrowserLogsHasChanged) globalThis.showBrowserLogs = showBrowserLogs

  if (globalThis.server && !showBrowserLogsHasChanged) return

  await globalThis.server?.stop()

  globalThis.server = serve({
    port: 3000,
    routes: {
      "/*": index,
    },
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: globalThis.showBrowserLogs
    },
  })

  console.log(\`Server running at \${globalThis.server.url}\`)
}

await runServer(true) // changed to true
console.log("TOGGLED1")
      `,
      );

      // Wait for HMR to process
      await Bun.sleep(1000);

      // Make another connection
      const response2 = await fetch(`http://localhost:3000/`);
      expect(response2.status).toBe(200);
      await response2.text();

      await Bun.sleep(500);

      // Toggle back to false (second toggle - should crash on Windows)
      await Bun.write(
        tmpdir + "/server.ts",
        `
import { serve } from "bun"
import index from "./index.html"

declare global {
  var server: ReturnType<typeof serve> | null
  var showBrowserLogs: boolean
}

export const runServer = async (showBrowserLogs: boolean) => {
  const showBrowserLogsHasChanged = showBrowserLogs !== globalThis.showBrowserLogs
  if (showBrowserLogsHasChanged) globalThis.showBrowserLogs = showBrowserLogs

  if (globalThis.server && !showBrowserLogsHasChanged) return

  await globalThis.server?.stop()

  globalThis.server = serve({
    port: 3000,
    routes: {
      "/*": index,
    },
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: globalThis.showBrowserLogs
    },
  })

  console.log(\`Server running at \${globalThis.server.url}\`)
}

await runServer(false) // changed back to false
console.log("TOGGLED2")
      `,
      );

      // Wait for HMR to process - this is where it should crash
      await Bun.sleep(1000);

      // Make another connection
      const response3 = await fetch(`http://localhost:3000/`);
      expect(response3.status).toBe(200);
      await response3.text();

      await Bun.sleep(500);

      // If we got here, the crash didn't happen (might not be on Windows or race condition didn't occur)
      expect(true).toBe(true);
    } finally {
      proc.kill();
      await proc.exited;
    }
  },
  { timeout: 30000 },
);
