import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// server.upgrade(req, opts) reads opts.data / opts.headers via property
// access, which can invoke user getters. A getter that calls
// server.upgrade(req) again on the same request used to perform a second
// upgrade on a uws response that had already been converted into a
// WebSocket, double-deref'ing the RequestContext in the process.

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
