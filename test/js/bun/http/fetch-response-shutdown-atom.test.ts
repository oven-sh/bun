import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for a flaky RELEASE_ASSERT observed in proxy.test.js under
// the x64 ASAN lane:
//
//   ASSERTION FAILED: wasRemoved
//   WTF/wtf/text/AtomStringImpl.cpp(409) : static void WTF::AtomStringImpl::remove(AtomStringImpl *)
//   "The string being removed is an atom in the string table of an other thread!"
//
// Root cause: FetchTasklet.toResponse() used bun.String.createAtomIfPossible
// for Response.status_text and Response.url. Atom strings live in a
// per-thread table. If the process exits while the HTTP thread is between
// releasing the callback mutex and running derefFromThread(), and
// BUN_DESTRUCT_VM_ON_EXIT is set (as the CI ASAN lane does), the
// HTTP thread ends up holding the last FetchTasklet ref after the JS
// thread has already finalized the JS Response wrapper. derefFromThread()'s
// isShuttingDown() branch then runs FetchTasklet.deinit() on the HTTP
// thread, which drops the last native Response ref and derefs the atom
// strings from the wrong thread -> assert.
//
// The fix uses bun.String.cloneUTF8 (plain WTFStringImpl, atomic refcount,
// no per-thread table) for status_text / url.
//
// This test recreates the CI conditions: BUN_DESTRUCT_VM_ON_EXIT=1 so the
// JS Response wrapper is finalized during the shutdown GC, http_proxy +
// NO_PROXY set so the env-proxy resolution path runs, and a batch of
// subprocesses spawned in parallel so the HTTP thread is contending for
// CPU at exit time. Before the fix this trips the assert intermittently
// on ASAN builds; after the fix it cannot, since the strings are no
// longer atoms.

describe("fetch Response status_text/url are safe to destroy off-thread", () => {
  test("parallel fetch-then-exit under BUN_DESTRUCT_VM_ON_EXIT does not trip AtomStringImpl::remove", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch() {
        // Tiny body so headers + body arrive in a single HTTP callback —
        // that's the path where derefFromThread() can be the last ref.
        return new Response("x");
      },
    });

    const script = `
      const resp = await fetch(${JSON.stringify(String(server.url))});
      // Touch the formerly-atomized fields so they're materialized.
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

    const iterations = 40;
    const concurrency = 8;
    const failures: string[] = [];

    for (let i = 0; i < iterations; i += concurrency) {
      const batch = Array.from({ length: Math.min(concurrency, iterations - i) }, () =>
        Bun.spawn({
          cmd: [bunExe(), "-e", script],
          env,
          stdout: "ignore",
          stderr: "pipe",
        }),
      );
      for (const proc of batch) {
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        if (exitCode !== 0) {
          failures.push(`exit ${exitCode}: ${stderr.slice(0, 500)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  }, 90_000);
});
