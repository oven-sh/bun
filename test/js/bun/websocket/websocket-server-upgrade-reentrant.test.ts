import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// server.upgrade(req, opts) reads opts.data / opts.headers via property
// access, which can invoke user getters. A getter that calls
// server.upgrade(req) again on the same request used to perform a second
// upgrade on a uws response that had already been converted into a
// WebSocket, double-deref'ing the RequestContext in the process.

// server.upgrade() reads Sec-WebSocket-Key/Protocol/Extensions from
// req.headers via FetchHeaders::fastGet, which returns a ZigString that
// BORROWS from the header map entry's StringImpl. It then invokes the
// opts.data / opts.headers getters (arbitrary user JS) before using those
// borrowed slices in the actual upgrade. A getter that mutates req.headers
// frees the backing StringImpl, and the subsequent resp.upgrade() read
// freed memory.
//
// WTF::StringImpl is allocated via bmalloc, which is not ASAN-instrumented by
// default. On Linux, `Malloc=1` makes bmalloc route through the system allocator
// so ASAN observes the free and flags the use-after-free in
// uWS::HttpResponse::upgrade(). We only do this on Linux: on Windows the
// bmalloc system-heap path crashes (SIGILL on aarch64), and with WTF allocations
// going through system malloc LeakSanitizer starts reporting pre-existing
// process-lifetime WebKit singletons, so we also disable LSan for the subprocess.
// On non-Linux platforms the test still verifies the upgrade completes
// successfully — regressions are caught by the Linux ASAN lane.
test("server.upgrade() clones Sec-WebSocket-* from request.headers before running option getters", async () => {
  using dir = tempDir("ws-upgrade-header-uaf", {
    "index.ts": `
      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          // Materialize the JS FetchHeaders so server.upgrade() reads the
          // Sec-WebSocket-* values from it (the borrowed-StringImpl path)
          // rather than from the raw uWS request buffer.
          req.headers.get("sec-websocket-key");

          const ok = server.upgrade(req, {
            get data() {
              // Drop the sole ref on the StringImpl that sec_websocket_key /
              // protocol / extensions were borrowed from. Without the fix,
              // the subsequent resp.upgrade() reads these freed bytes.
              req.headers.set("sec-websocket-key", "overwritten-overwritten-overwritten");
              req.headers.set("sec-websocket-protocol", "overwritten-overwritten-overwritten");
              req.headers.set("sec-websocket-extensions", "overwritten-overwritten-overwritten");
              return undefined;
            },
          });
          if (!ok) return new Response("no upgrade", { status: 500 });
        },
        websocket: {
          open(ws) {
            ws.send("hello");
          },
          message() {},
          close() {},
        },
      });

      const ws = new WebSocket(server.url.href.replace("http", "ws"), "chat");
      const got = await new Promise<string>((resolve, reject) => {
        ws.onmessage = e => {
          resolve(String(e.data));
          ws.close();
        };
        ws.onerror = () => reject(new Error("ws error"));
        ws.onclose = e => {
          if (e.code !== 1000 && e.code !== 1005) reject(new Error("ws closed: " + e.code + " " + e.reason));
        };
      });
      console.log("got=" + got);
      server.stop(true);
      process.exit(0);
    `,
  });

  const env: Record<string, string | undefined> = { ...bunEnv };
  if (isLinux) {
    // Route bmalloc through the system heap so ASAN sees StringImpl frees.
    env.Malloc = "1";
    // Skip symbolization so an ASAN abort (the pre-fix behaviour) exits
    // promptly; disable LSan because routing WTF allocations through system
    // malloc makes pre-existing process-lifetime WebKit singletons visible
    // to LeakSanitizer at exit.
    env.ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":");
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("got=hello");
  expect(exitCode).toBe(0);
});

for (const via of ["data", "headers"] as const) {
  test(`server.upgrade() is safe against re-entrant upgrade from options.${via} getter`, async () => {
    using dir = tempDir("ws-upgrade-reentrant", {
      "index.ts": `
        let opens = 0;
        const server = Bun.serve({
          port: 0,
          fetch(req, server) {
            let once = false;
            const outer = server.upgrade(req, {
              get ${via}() {
                if (!once) {
                  once = true;
                  const inner = server.upgrade(req);
                  console.log("inner=" + inner);
                }
                return ${via === "data" ? "{ tag: 'outer' }" : "undefined"};
              },
            });
            console.log("outer=" + outer);
            if (!outer) return new Response("no upgrade");
          },
          websocket: {
            open(ws) {
              opens++;
              ws.send("hello");
            },
            message(ws) {
              ws.close();
            },
            close() {},
          },
        });

        const ws = new WebSocket(server.url.href.replace("http", "ws"));
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => ws.send("ping");
          ws.onmessage = () => {
            ws.close();
            resolve();
          };
          ws.onerror = (e) => reject(new Error("ws error"));
          ws.onclose = () => resolve();
        });

        console.log("opens=" + opens);
        server.stop(true);
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // The inner (re-entrant) upgrade consumes the request; the outer call
    // must observe this and return false instead of upgrading again.
    expect(stdout).toContain("inner=true");
    expect(stdout).toContain("outer=false");
    // Exactly one WebSocket connection should have been opened.
    expect(stdout).toContain("opens=1");
    expect(exitCode).toBe(0);
  });
}
