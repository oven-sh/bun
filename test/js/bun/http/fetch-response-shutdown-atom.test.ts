import { fetchTestingInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for a flaky RELEASE_ASSERT observed in proxy.test.js under
// the x64 ASAN lane:
//
//   ASSERTION FAILED: wasRemoved
//   WTF/wtf/text/AtomStringImpl.cpp(409) : static void WTF::AtomStringImpl::remove(AtomStringImpl *)
//   "The string being removed is an atom in the string table of an other thread!"
//
// Root cause: FetchTasklet.toResponse() atomizes Response.status_text and
// Response.url for dedup (many responses share "OK"). Atom strings live in
// a per-thread table. In FetchTasklet.callback() (HTTP thread), the defer
// order used to be: enqueue onProgressUpdate -> unlock mutex ->
// derefFromThread(). In the gap between unlock and derefFromThread(), the
// JS thread could run onProgressUpdate (which derefs the tasklet 2->1 and
// unrefs poll_ref), finish the user script, and — with
// BUN_DESTRUCT_VM_ON_EXIT=1 as the ASAN CI lane sets — run destructOnExit's
// full GC, finalizing the JS Response wrapper. Then the HTTP thread's
// derefFromThread() would see count==1 + isShuttingDown() and run deinit()
// on the HTTP thread, dropping the last native Response ref and deref'ing
// the atom strings from the wrong thread -> assert.
//
// Fix: callback() now runs derefFromThread() BEFORE releasing the mutex.
// onProgressUpdate needs that mutex, so while the HTTP thread holds it the
// JS side cannot have dropped its baseline ref — the HTTP deref is always
// N->N-1 with N>=2, never the last ref. poll_ref (unref'd inside
// onProgressUpdate) therefore keeps the VM alive until the HTTP thread is
// done with the tasklet, and deinit() only ever runs on the JS thread where
// the atom strings were registered.
//
// The race window was a handful of instructions and not reproducible via
// timing alone. This test documents the intent (status_text/url remain
// atomized for memory dedup — deliberately, since the race is now closed
// structurally) and exercises the shutdown path end-to-end.

describe("fetch Response status_text/url atom strings are JS-thread-owned", () => {
  test("backing strings are atomized (dedup) and survive a round-trip", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("x", { status: 200, statusText: "OK" });
      },
    });

    const resp = await fetch(server.url);
    expect(resp.statusText).toBe("OK");
    expect(resp.url).toBe(String(server.url));

    // status_text and url are intentionally atomized for memory dedup.
    // This is safe because callback() holds the tasklet mutex through
    // derefFromThread(), guaranteeing the HTTP thread is never the last
    // ref and Response.destroy() runs on the JS thread that owns the atoms.
    const flags = fetchTestingInternals.responseAtomFlags(resp);
    expect(flags).toEqual({ statusText: true, url: true });
  });

  test("parallel fetch-then-exit under BUN_DESTRUCT_VM_ON_EXIT does not trip AtomStringImpl::remove", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch() {
        // Tiny body so headers + body arrive in a single HTTP callback —
        // that's the path where derefFromThread() is the HTTP-side deref.
        return new Response("x");
      },
    });

    const script = `
      const resp = await fetch(${JSON.stringify(String(server.url))});
      // Touch the atomized fields so they're materialized.
      resp.statusText;
      resp.url;
      resp.headers.get("x-proxy-used");
    `;

    // Reproduce the original report's environment: proxy resolution runs,
    // NO_PROXY matches so the request goes direct. Set BOTH casings for
    // the proxy vars — env_loader.getHttpProxy / isNoProxy read lowercase
    // first, so an inherited lowercase value from bunEnv would otherwise
    // win over our uppercase one and send the subprocess at the dead proxy.
    const noProxy = `example.com, localhost:1, localhost:${server.port}, 127.0.0.1`;
    const env = {
      ...bunEnv,
      // Force VM teardown + full GC at exit so the JS Response wrapper is
      // finalized before bun.Global.exit(). The ASAN CI lane sets this.
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      http_proxy: `http://127.0.0.1:1`,
      HTTP_PROXY: `http://127.0.0.1:1`,
      https_proxy: "",
      HTTPS_PROXY: "",
      NO_PROXY: noProxy,
      no_proxy: noProxy,
    };

    // One parallel batch is enough to document the end-to-end shutdown
    // path — the invariant is guaranteed structurally by the defer order.
    const batch = Array.from({ length: 8 }, () =>
      Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env,
        stdout: "ignore",
        stderr: "pipe",
      }),
    );
    const failures: string[] = [];
    for (const proc of batch) {
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) {
        failures.push(`exit ${exitCode}: ${stderr.slice(0, 500)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
