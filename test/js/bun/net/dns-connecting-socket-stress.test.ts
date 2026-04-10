// Stress the us_connecting_socket_t lifecycle: many concurrent connects to a
// hostname that resolves to >1 address (so every connect allocates a
// us_connecting_socket_t and goes through dns_ready_head), aborted at random
// points. Catches use-after-free in us_internal_socket_after_resolve under
// ASAN — the production crash signature is
//   Segmentation fault at address 0x0
//   loop.c:238 us_internal_drain_pending_dns_resolve
// where a freed-and-recycled us_connecting_socket_t (c->context == NULL) is
// dequeued from dns_ready_head. The ->next field is shared between
// dns_ready_head and closed_connecting_head, so any path that enqueues c on
// both is a UAF waiting to happen; this test hammers the create/close window
// to surface it.
//
// The fix separates the two lists (own next_closed link) and guards
// us_connecting_socket_free against double-enqueue with a scheduled_for_free
// bit, so even if a future change violates the pending_resolve_callback
// invariant the list can't be corrupted.
import { test, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// Without ASAN this either passes cleanly (no observable effect) or segfaults
// non-deterministically after minutes. Only meaningful under ASAN where the
// UAF is caught deterministically at the free site.
test.skipIf(!isASAN)(
  "concurrent hostname connects aborted during DNS resolve do not UAF in after_resolve",
  async () => {
    // Run in a subprocess so an ASAN abort shows up as a non-zero exit and the
    // test runner itself survives.
    const fixture = /* js */ `
      const net = require("node:net");

      // Server that accepts and immediately closes — we only care about the
      // connect path, not data.
      const server = net.createServer((sock) => sock.destroy());
      server.listen(0, "127.0.0.1", run);
      // Also listen on ::1 so 'localhost' yields >1 address on hosts with v6.
      const server6 = net.createServer((sock) => sock.destroy());
      server6.listen(0, "::1", () => {}).on("error", () => {});

      async function run() {
        const port = server.address().port;
        const ITERS = 25_000;
        const CONC  = 512;
        let done = 0;

        function one() {
          return new Promise((resolve) => {
            // 'localhost' (not '127.0.0.1') so it hits getaddrinfo and
            // us_socket_context_connect allocates a us_connecting_socket_t.
            // With both v4 and v6 results the cached-result path also always
            // falls through to the us_connecting_socket_t branch.
            const s = net.connect({ host: "localhost", port }, () => {
              s.destroy();
              resolve();
            });
            s.on("error", () => resolve());
            s.on("close", () => resolve());
            // Abort at a random point across the resolve → connect window.
            const r = Math.random();
            if (r < 0.25) queueMicrotask(() => s.destroy());
            else if (r < 0.5) setImmediate(() => s.destroy());
            else if (r < 0.75) setTimeout(() => s.destroy(), 0);
            // else: let it connect
          }).finally(() => done++);
        }

        const inflight = new Set();
        let started = 0;
        while (started < ITERS) {
          while (inflight.size < CONC && started < ITERS) {
            started++;
            const p = one();
            inflight.add(p);
            p.finally(() => inflight.delete(p));
          }
          await Promise.race(inflight);
        }
        await Promise.allSettled([...inflight]);
        server.close();
        server6.close?.();
        console.log("OK " + done);
      }
    `;

    using dir = tempDir("dns-connecting-socket-stress", {
      "stress.js": fixture,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "stress.js"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        // Force every connect through the resolver and a fresh Request so
        // many us_connecting_socket_t objects cycle through dns_ready_head.
        BUN_FEATURE_FLAG_DISABLE_DNS_CACHE: "1",
        // Make recycling of freed blocks aggressive so a UAF surfaces as
        // c->context == NULL quickly (ASAN quarantine otherwise delays reuse;
        // quarantine_size_mb=0 disables it so the recycled-calloc path that
        // the production crash relies on can happen).
        ASAN_OPTIONS: (bunEnv.ASAN_OPTIONS ?? "") + ":quarantine_size_mb=0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // ASAN prints "heap-use-after-free" / "AddressSanitizer" to stderr and
    // exits non-zero; a clean run prints "OK <n>" and exits 0.
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stderr).not.toContain("use-after-free");
    expect(stdout).toContain("OK ");
    expect(exitCode).toBe(0);
  },
);
