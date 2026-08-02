import { expect, test } from "bun:test";
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
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
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
        join(dir, "index.html"),
      ],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The dev-server bundler prints "Bundled page in Nms: <path>" to stderr on
    // first request; strip it so the assertion shows only LSan's report.
    const filtered = stderr
      .split("\n")
      .filter(l => !l.includes("Bundled page in "))
      .join("\n")
      .trim();
    expect({ stdout, stderr: filtered, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  // LSan symbolizes through llvm-symbolizer on failure, which is slow against
  // the debug binary.
  30_000,
);
