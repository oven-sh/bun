import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

// The macOS `getaddrinfo_async_start` path watches a mach port via
// EVFILT_MACHPORT. If that reply is never observed (seen in CI on one host
// immediately after its nightly reboot), the cache entry stayed in-flight
// forever and every later connect to the same host:port coalesced onto it.
// The periodic sweep now cancels the async work unit and re-issues the lookup
// on the work-pool libc path.
//
// `BUN_INTERNAL_DNS_LIBINFO_SIMULATE_STALL` is the test hook that reproduces
// the lost-reply condition; it is part of this change, so a build without the
// hook (the fail-before case) has no way to observe the stall.
describe.skipIf(!isMacOS).concurrent("macOS libinfo DNS stale-request fallback", () => {
  const stallEnv = {
    ...bunEnv,
    BUN_INTERNAL_DNS_LIBINFO_SIMULATE_STALL: "1",
  };

  test("a stalled libinfo DNS request falls back to the work-pool resolver", async () => {
    const script = `
        const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
        const t0 = performance.now();
        const res = await fetch("http://localhost:" + server.port + "/");
        const body = await res.text();
        const dt = performance.now() - t0;
        await server.stop();
        console.log(JSON.stringify({ body, dt: Math.round(dt) }));
      `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: stallEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = JSON.parse(stdout.trim() || "null");
    expect({ out, stderr, exitCode }).toEqual({
      out: { body: "ok", dt: expect.any(Number) },
      stderr: "",
      exitCode: 0,
    });
    // With the simulated stall the request cannot complete via libinfo; the
    // ~4s uws sweep has to fire at least once before the work-pool fallback
    // runs. A sub-second completion would mean the stall was not exercised.
    expect(out.dt).toBeGreaterThan(3000);
  }, 30_000);

  test("fallback unblocks waiters that coalesced on the stalled entry", async () => {
    const script = `
        const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
        const url = "http://localhost:" + server.port + "/";
        const bodies = await Promise.all([
          fetch(url, { keepalive: false }).then(r => r.text()),
          fetch(url, { keepalive: false }).then(r => r.text()),
          fetch(url, { keepalive: false }).then(r => r.text()),
        ]);
        await server.stop();
        console.log(JSON.stringify(bodies));
      `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: stallEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ out: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
      out: ["ok", "ok", "ok"],
      stderr: "",
      exitCode: 0,
    });
  }, 30_000);
});
