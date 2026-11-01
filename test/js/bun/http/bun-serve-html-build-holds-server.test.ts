import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// An HTML route served without the DevServer bundles on its first request. The
// plugin load and the build finish on later event-loop turns and call back into
// the server through the route's raw back-pointer, while the clients waiting on
// the build only count as connections. Once they disconnected, nothing kept the
// server alive: stop(true) settled, the wrapper became collectable, the server
// was freed, and the build's completion then used it (heap-use-after-free in
// Route::on_complete or Route::on_plugins_resolved under ASAN). A building route
// now holds a pending request on the server, so stop() cannot settle before the
// build has finished and the server is still there when it does.
//
// The fixture parks the route inside the plugin (argv[2] picks where), drops
// the only client, calls stop(true), drops the server, and reports whether
// stop() settled while the route was still parked.
const fixture = {
  "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
  "index.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="./entry.ts"></script></body></html>`,
  "entry.ts": `console.log("entry");`,
  "plugin.ts": /* ts */ `
    const { __mode: mode, __parked: parked, __release: release } = globalThis as any;
    export default {
      name: "park-the-route",
      async setup(build: any) {
        if (mode.startsWith("plugin setup")) {
          parked();
          await release;
          if (mode === "plugin setup rejection") throw new Error("plugin setup rejected on purpose");
        }
        build.onLoad({ filter: /entry\\.ts$/ }, async () => {
          if (mode === "build") {
            parked();
            await release;
          }
          return { loader: "ts", contents: "console.log('built')" };
        });
      },
    };
  `,
  "run.ts": /* ts */ `
    import html from "./index.html";

    // Read by plugin.ts, which Bun.serve loads into this same global on the
    // first request.
    const parked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    Object.assign(globalThis, { __mode: process.argv[2], __parked: parked.resolve, __release: release.promise });

    let collected = false;
    const registry = new FinalizationRegistry(() => void (collected = true));
    const turn = () => new Promise<void>(r => setTimeout(r, 0));
    async function collectServer() {
      for (let i = 0; i < 50 && !collected; i++) {
        Bun.gc(true);
        await turn();
      }
      return collected;
    }

    // Its own frame, so that nothing on the stack still refers to the server
    // once it returns.
    async function stopWhileParked() {
      const server = Bun.serve({
        port: 0,
        development: false,
        routes: { "/": html },
        fetch: () => new Response("fallback"),
      });
      registry.register(server, "server");
      const controller = new AbortController();
      const request = fetch(server.url, { signal: controller.signal }).then(
        response => "status " + response.status,
        error => error.name,
      );
      await parked.promise;
      const pendingRequestsWhileParked = server.pendingRequests;
      controller.abort();
      return { fetch: await request, pendingRequestsWhileParked, stopped: server.stop(true) };
    }

    const { fetch: fetchResult, pendingRequestsWhileParked, stopped } = await stopWhileParked();
    let settled = false;
    stopped.then(() => void (settled = true));
    for (let i = 0; i < 10; i++) await turn();
    const stopBeforeRelease = settled ? "settled" : "pending";
    if (settled) {
      // Nothing holds the server for the parked route: let it be freed before
      // the route resumes, which is the use-after-free.
      await collectServer();
      await turn();
    }

    release.resolve();
    await stopped;
    console.log(
      JSON.stringify({
        fetch: fetchResult,
        pendingRequestsWhileParked,
        stopBeforeRelease,
        collectedAfterwards: await collectServer(),
      }),
    );
  `,
};

test.concurrent.each(["build", "plugin setup", "plugin setup rejection"])(
  "a server whose HTML route is parked in its %s outlives stop(true) until the route is done",
  async mode => {
    using dir = tempDir("serve-html-build-holds-server", fixture);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.ts", mode],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // A crash (the ASAN report) replaces the fixture's report in the assertion.
    expect(stdout.trim() === "" ? stderr : JSON.parse(stdout)).toEqual({
      fetch: "AbortError",
      pendingRequestsWhileParked: 1,
      stopBeforeRelease: "pending",
      collectedAfterwards: true,
    });
    if (mode === "plugin setup rejection") {
      expect(stderr).toContain("plugin setup rejected on purpose");
    } else {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  },
  // Passes in about a second; the ceiling is for the failure path, where ASAN
  // symbolizes the report against the debug binary before the child exits.
  30_000,
);
