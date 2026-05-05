import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as validTls } from "harness";
import { join } from "node:path";

// Each SNI hostname in Bun.serve({ tls: [...] }) heap-allocates an HttpRouter
// inside uWS. Prior to the pendingServerNames ownership model in
// TemplatedApp, the router was stashed as ex_data on the per-hostname
// SSL_CTX and never freed on teardown (only the SSL_CTX was), leaking one
// router + its route handler tree per hostname per server. Repeatedly
// creating and stopping an SNI server should therefore not grow RSS
// unboundedly.
test("Bun.serve() with SNI hostnames does not leak per-hostname HttpRouter on stop()", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(import.meta.dir, "bun-serve-sni-leak-fixture.js")],
    env: {
      ...bunEnv,
      TLS_CERT: validTls.cert,
      TLS_KEY: validTls.key,
      ITERATIONS: "250",
      SNI_NAMES: "12",
      // On ASAN builds, freed memory sits in the quarantine and inflates
      // RSS even though it has been released. Disable quarantine so RSS
      // tracks live allocations. Release builds ignore ASAN_OPTIONS.
      ASAN_OPTIONS: "quarantine_size_mb=0:allow_user_segv_handler=1:detect_leaks=0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Surface the subprocess's own failure before attempting to parse its
  // output so a crash doesn't present as an opaque JSON.parse error.
  if (!stdout.trim()) {
    throw new Error(`fixture produced no output (exit ${exitCode}):\n${stderr}`);
  }

  const result = JSON.parse(stdout.trim());
  console.log(
    `SNI leak check: ${result.iterations} iterations x ${result.sniNames} hostnames, ` +
      `growth: ${result.growthMB} MB`,
  );

  // Without the fix each iteration leaks ~12 HttpRouter instances (3.3 KB
  // each) plus their route handler trees; 250 iterations pushes well past
  // 80 MB on release and ~140 MB on debug. With the fix, steady-state
  // growth after warmup is under 15 MB.
  expect(result.growthMB).toBeLessThan(50);
  expect(exitCode).toBe(0);
}, 120_000);
