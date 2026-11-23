import { expect, test } from "bun:test";
import { bunEnv, bunExe, Heap, tempDir } from "harness";

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
// stop() settled while the route was still parked, whether the server was
// collected once the route is done, and what holds a server that was not.
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
    import { generateHeapSnapshotForDebugging, jscDescribe } from "bun:jsc";
    import html from "./index.html";
    ${Heap}

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

    // The way from a root to the server, or null when no root reaches it. The
    // heap snapshot lists every root but the words of the native stack, which
    // the collector also marks from.
    let serverAddress = 0n;
    let heap: any;
    async function whatHoldsTheServer(): Promise<string | null> {
      // From a timer, so that the caller is suspended and its frame is in the heap.
      heap = new Promise(resolve => setTimeout(() => resolve(new Heap()), 0));
      heap = await heap;
      return heap.pathTo(serverAddress) ?? null;
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
      serverAddress = BigInt(/0x[0-9a-fA-F]+/.exec(jscDescribe(server))![0]);
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

    const heldWhileParkedBy = process.argv[3] === "while parked" ? await whatHoldsTheServer() : undefined;
    release.resolve();
    await stopped;
    const collectedAfterwards = await collectServer();
    console.log(
      JSON.stringify({
        fetch: fetchResult,
        pendingRequestsWhileParked,
        stopBeforeRelease,
        heldWhileParkedBy,
        collectedAfterwards,
        heldAfterwardsBy: collectedAfterwards ? null : await whatHoldsTheServer(),
      }),
    );
  `,
};

const modes = ["build", "plugin setup", "plugin setup rejection"];

// `heldWhileParkedBy` makes the fixture also report what holds the server while the route is parked.
async function runFixture(mode: string, env = bunEnv, heldWhileParkedBy?: unknown) {
  using dir = tempDir("serve-html-build-holds-server", fixture);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts", mode, heldWhileParkedBy ? "while parked" : "afterwards"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const report = {
    fetch: "AbortError",
    pendingRequestsWhileParked: 1,
    stopBeforeRelease: "pending",
    collectedAfterwards: true,
    heldAfterwardsBy: null,
  };
  // A crash (the ASAN report) replaces the fixture's report in the assertion.
  expect(stdout.trim() === "" ? stderr : JSON.parse(stdout)).toEqual(
    heldWhileParkedBy ? { ...report, heldWhileParkedBy } : report,
  );
  if (mode === "plugin setup rejection") {
    expect(stderr).toContain("plugin setup rejected on purpose");
  } else {
    expect(stderr).toBe("");
  }
  expect(exitCode).toBe(0);
}

// Passes in about a second; the ceiling is for the failure path, where ASAN
// symbolizes the report against the debug binary before the child exits.
const ceiling = 30_000;

test.concurrent.each(modes)(
  "a server whose HTML route is parked in its %s outlives stop(true) until the route is done",
  mode => runFixture(mode),
  ceiling,
);

// With the GC timer off Bun requests no collection of its own, also not when
// the server starts to listen. On Windows x64 the server of "plugin setup
// rejection" then stayed uncollected for as long as libuv's uv__poll was
// inlined into uv_run (#49409).
test.concurrent.each(modes)(
  "nothing holds a server whose HTML route was parked in its %s once the route is done, with the GC timer off",
  mode => runFixture(mode, { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" }),
  ceiling,
);

test.concurrent(
  "the snapshot lists the strong handle that holds the server of a parked route",
  () =>
    runFixture(
      "build",
      bunEnv,
      expect.stringMatching(/^root\(StrongHandles\) StrongRootBlock -Internal:\d+-> HTTPServer$/),
    ),
  ceiling,
);
