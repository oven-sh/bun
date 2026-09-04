import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

test("dev server html route: non-GET/HEAD requests complete without hanging", async () => {
  await using dir = tempDir("html-route-405", {
    "index.html": `<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>`,
  });
  const { default: html } = await import(join(dir, "index.html"));

  using server = Bun.serve({
    port: 0,
    development: true,
    routes: { "/": html },
    fetch(req) {
      return new Response("Not found", { status: 404 });
    },
  });

  // GET should serve the page.
  {
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>t</title>");
  }

  // Non-GET/HEAD requests used to write a bare `405` status line with no
  // Content-Length, so HTTP/1.1 keep-alive clients would block forever
  // waiting for framing.
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
    const res = await fetch(server.url, { method });
    await res.arrayBuffer();
    expect({
      method,
      status: res.status,
      contentLength: res.headers.get("content-length"),
      allow: res.headers.get("allow"),
    }).toEqual({
      method,
      status: 405,
      contentLength: "0",
      allow: "GET, HEAD",
    });
  }
});

// The tests below exit a child under LeakSanitizer with BUN_DESTRUCT_VM_ON_EXIT,
// the way the ASAN CI lane runs every test, and expect a silent, clean exit.
const leaksanSupp = join(import.meta.dirname, "../../../leaksan.supp");

// LSan symbolizes its report through llvm-symbolizer on failure, which is slow
// against the debug binary.
const LEAK_TEST_TIMEOUT = 30_000;

async function exitUnderLeakSanitizer(script: string, { args = [] as string[], suppressions = leaksanSupp } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script, ...args],
    env: {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
      LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${suppressions}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A server whose JS wrapper survives to lastChanceToFinalize used to leak its
// NewServer Box: finalize() -> schedule_deinit() enqueued a ManagedTask that
// the now-exiting event loop never ran. The html_bundle::Route.server
// back-pointer makes the orphaned Box a pointer cycle, so LSan reports every
// interior allocation as an indirect leak. Only observable via LeakSanitizer.
test.skipIf(!isASAN || isWindows)(
  "stopped Bun.serve with a static route is freed at VM teardown",
  async () => {
    await using dir = tempDir("serve-static-route-teardown-leak", {
      "index.html": `<!DOCTYPE html><html><body>hi</body></html>`,
    });
    const { stdout, stderr, exitCode } = await exitUnderLeakSanitizer(
      `
        const { default: html } = await import(process.argv[1]);
        const server = Bun.serve({
          port: 0,
          development: true,
          routes: { "/": html },
          fetch: () => new Response("no"),
        });
        await (await fetch(server.url)).text();
        server.stop(true);
      `,
      { args: [join(dir, "index.html")] },
    );
    // The dev-server bundler prints "Bundled page in Nms: <path>" to stderr on
    // first request; strip it so the assertion shows only LSan's report.
    const filtered = stderr
      .split("\n")
      .filter(l => !l.includes("Bundled page in "))
      .join("\n")
      .trim();
    expect({ stdout, stderr: filtered, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  LEAK_TEST_TIMEOUT,
);

// The common shape of the scenarios below (nothing pins the server, stop() is
// not awaited), run under the CI lane's full suppression list: freeing the
// gracefully stopped server at teardown has to leave nothing behind there
// either, in particular the keep-alive socket that stop() closed (a socket
// still linked into the app would be a direct leak no suppression covers).
test.skipIf(!isASAN || isWindows)(
  "gracefully-stopped Bun.serve does not orphan a keep-alive socket at VM teardown",
  async () => {
    const result = await exitUnderLeakSanitizer(`
      const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      await (await fetch(server.url)).text();
      server.stop();
    `);
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  LEAK_TEST_TIMEOUT,
);

// After a graceful stop() (or node:http server.close()) the drained server is
// only freed once its JS object is finalized. When that happens during VM
// teardown, finalize() has to free it inline (no event-loop tick will run the
// deferred deinit); it used to do so only after an abrupt stop, so every
// gracefully stopped server still referenced at exit leaked its NewServer Box,
// uws app and routers.
//
// That leak hides behind `leak:uws_create_app` in leaksan.supp: LSan also
// suppresses everything reachable from a suppressed block, so the whole cycle
// vanishes and only the llvm-symbolizer pass LSan needs to match the
// suppression remains (about 15s per such child on the ASAN lane). These
// children therefore run against the suppression list minus that entry. They
// create the server only after a timer tick, because a Bun.serve() call made
// synchronously from the module body has JSModuleLoader::evaluateNonVirtual
// (suppressed as well) on every allocation's stack, and they keep the server
// on globalThis so that its wrapper is finalized by the teardown and never by
// an earlier GC.
describe.skipIf(!isASAN || isWindows)(
  "a gracefully stopped server still referenced at exit is freed at VM teardown",
  () => {
    const scenarios: [name: string, script: string][] = [
      [
        "Bun.serve stop() after serving a request",
        `
          await Bun.sleep(0);
          const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
          globalThis.keep = server;
          await (await fetch(server.url)).text();
          await server.stop();
        `,
      ],
      [
        "Bun.serve stop() before any connection",
        `
          await Bun.sleep(0);
          const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
          globalThis.keep = server;
          await server.stop();
        `,
      ],
      [
        "node:http server.close()",
        `
          import { createServer } from "node:http";
          await Bun.sleep(0);
          const server = createServer((req, res) => res.end("ok"));
          globalThis.keep = server;
          await new Promise(resolve => server.listen(0, resolve));
          await (await fetch("http://127.0.0.1:" + server.address().port + "/")).text();
          await new Promise(resolve => server.close(resolve));
        `,
      ],
      [
        // The websocket keeps the server draining past stop(); the teardown's
        // stop phase closes it (the stop() promise never settles, script is
        // forbidden by then) and the finalizer then finds the server drained.
        "Bun.serve stop() with a websocket still open at process.exit()",
        `
          await Bun.sleep(0);
          const server = Bun.serve({
            port: 0,
            fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no")),
            websocket: { message() {} },
          });
          globalThis.keep = server;
          const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/");
          const { promise, resolve, reject } = Promise.withResolvers();
          ws.onopen = resolve;
          ws.onclose = reject;
          await promise;
          server.stop();
          process.exit(0);
        `,
      ],
    ];

    test.concurrent.each(scenarios)(
      "%s",
      async (_name, script) => {
        const suppressions = (await Bun.file(leaksanSupp).text())
          .split("\n")
          .filter(line => line.trim() !== "leak:uws_create_app")
          .join("\n");
        using dir = tempDir("serve-teardown-leak", { "leaksan.supp": suppressions });
        const result = await exitUnderLeakSanitizer(script, { suppressions: join(String(dir), "leaksan.supp") });
        expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      },
      LEAK_TEST_TIMEOUT,
    );
  },
);
