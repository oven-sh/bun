import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
test("abort the request on the other side if the stream is canceled", async () => {
  const { promise: abort, resolve: resolveAbort } = Promise.withResolvers();
  await using server = createServer((req, res) => {
    res.writeHead(200);
    res.write("hello");
    req.on("aborted", resolveAbort);
    // Let's not end the response on purpose
  }).listen(0);
  await once(server, "listening");

  const url = new URL(`http://127.0.0.1:${server.address().port}`);

  const response = await fetch(url);

  const reader = response.body.getReader();

  try {
    await reader.read();
  } finally {
    reader.releaseLock();
    await response.body.cancel();
  }

  await abort;
});

// When a fetch finishes right as the process exits, the HTTP thread can drop
// the tasklet's last reference while the VM is still running and hand the
// reclaim to an event loop that never ticks again. That handoff used to be
// dropped unrun at shutdown, orphaning the FetchTasklet / AsyncHTTP / native
// Response cycle, which LeakSanitizer reported at exit (SIGABRT) in compiled
// server binaries.
//
// Deterministic variant: the fault-injection flag holds the HTTP thread's
// trailing deref so the JS thread always wins the final-deref race, and the
// process.on("exit") spin keeps `is_shutting_down` unset long enough that the
// handoff always lands after the event loop's last drain. Every run reclaims
// the handoff through the shutdown release pass (or leaks, before the fix).
test.skipIf(!isASAN || isWindows)(
  "fetch tasklet handed off to an exiting event loop is reclaimed (deterministic)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
          server.unref();
          const res = await fetch(server.url);
          await res.text();
          process.on("exit", () => {
            const end = Date.now() + 1000;
            while (Date.now() < end) {}
          });
        `,
      ],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        BUN_INTERNAL_FETCH_DELAY_DEREF_FROM_THREAD: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1", "abort_on_error=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  30_000,
);

// Exit in the middle of a streaming upload: the request is still in
// `in_flight` on the HTTP thread, the request-body sink holds a tasklet ref,
// and a queued drain hop may be pending. The shutdown reclaim path must
// release all of them (LSan reports whatever it misses).
test.skipIf(!isASAN || isWindows)(
  "exiting mid streaming upload reclaims the in-flight fetch tasklet",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = Bun.serve({
            port: 0,
            async fetch(req) {
              const reader = req.body.getReader();
              await reader.read();
              // First chunk arrived; the upload is in flight. Exit now.
              process.exit(0);
            },
          });
          const chunk = new Uint8Array(65536);
          fetch(server.url, {
            method: "POST",
            body: new ReadableStream({
              pull(controller) {
                controller.enqueue(chunk);
                // never closes
              },
            }),
          }).catch(() => {});
          // Park until the server handler exits the process.
          await new Promise(() => {});
        `,
      ],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1", "abort_on_error=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  30_000,
);

// The original CI reproduction: a compiled server whose fetches complete right
// before exit. The handoff is a scheduling race here, so this runs the
// compiled server repeatedly, in parallel batches; every run must exit
// cleanly.
test.skipIf(!isASAN || isWindows)(
  "compiled server exiting right after its fetches complete does not leak the fetch tasklet",
  async () => {
    using dir = tempDir("fetch-exit-leak", {
      "entry.ts": `
        import home from "./home.html";
        import about from "./about.html";

        using server = Bun.serve({
          port: 0,
          routes: {
            "/": home,
            "/about": about,
          },
          fetch: async req => new Response(String((await req.bytes()).length)),
        });

        // A streaming upload first, so the request-body drain hop runs under
        // this test's leak-checked exit regime. The two GETs stay last: the
        // leak race is between the final response and process exit.
        const chunk = new Uint8Array(65536);
        const echoRes = await fetch(server.url + "echo", {
          method: "POST",
          body: new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk);
              if ((this.sent = (this.sent ?? 0) + 1) >= 8) controller.close();
            },
          }),
        });
        console.log("Echo bytes:", await echoRes.text());

        const homeRes = await fetch(server.url);
        console.log("Home status:", homeRes.status);
        const homeHtml = await homeRes.text();
        console.log("Home has content:", homeHtml.includes("Home Page"));

        const aboutRes = await fetch(server.url + "about");
        console.log("About status:", aboutRes.status);
        const aboutHtml = await aboutRes.text();
        console.log("About has content:", aboutHtml.includes("About Page"));
      `,
      "home.html": `<!DOCTYPE html><html><head><title>Home</title><link rel="stylesheet" href="./styles.css"></head><body><h1>Home Page</h1><script src="./app.js"></script></body></html>`,
      "about.html": `<!DOCTYPE html><html><head><title>About</title><link rel="stylesheet" href="./styles.css"></head><body><h1>About Page</h1><script src="./app.js"></script></body></html>`,
      "styles.css": `body { margin: 0; }`,
      "app.js": `console.log("App loaded");`,
    });

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./entry.ts", "--outfile=server"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // stdout is drained but not asserted: `bun build --compile` prints
    // progress there on success.
    const [, buildErr, buildCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ buildErr: buildErr.includes("error") ? buildErr : "", buildCode }).toEqual({
      buildErr: "",
      buildCode: 0,
    });

    const env = {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1", "abort_on_error=1"].filter(Boolean).join(":"),
      LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
    };
    const expectedStdout =
      "Echo bytes: 524288\nHome status: 200\nHome has content: true\nAbout status: 200\nAbout has content: true\n";

    const procs: Bun.Subprocess<"ignore", "pipe", "pipe">[] = [];
    try {
      for (let round = 0; round < 24; round++) {
        procs.length = 0;
        for (let i = 0; i < 8; i++) {
          procs.push(
            Bun.spawn({
              cmd: [join(String(dir), "server")],
              env,
              stdout: "pipe",
              stderr: "pipe",
            }),
          );
        }
        const results = await Promise.all(
          procs.map(async proc => {
            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            return { stdout, stderr, exitCode };
          }),
        );
        for (const result of results) {
          expect(result).toEqual({ stdout: expectedStdout, stderr: "", exitCode: 0 });
        }
      }
    } finally {
      // On a mid-batch spawn failure or assertion, don't orphan the rest.
      for (const proc of procs) proc.kill();
    }
  },
  // 192 compiled-binary runs; LSan symbolizes through llvm-symbolizer on
  // failure, which is slow against the debug binary.
  240_000,
);
