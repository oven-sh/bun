import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";
import tls from "node:tls";

// us_internal_init_root_certs() used to publish "initialized" (via
// atomic_exchange) BEFORE it finished parsing the bundled root certs and
// populating the extra/system STACK_OF(X509)*. Concurrent callers (Workers,
// or the first TLS connection) would observe the flag, skip initialization,
// and read the certificate stacks while they were still being mutated /
// realloc'd by the initializing thread. That showed up as tls.getCACertificates()
// returning different (truncated) lists depending on timing, and in some
// environments as a segfault inside BoringSSL's X509/EC parsing when a torn
// read handed a freed or garbage pointer down the call chain.
//
// This test races many Workers against a large NODE_EXTRA_CA_CERTS bundle so
// there is a wide window during initialization, and asserts that every Worker
// observes the exact same, fully-populated certificate list.

describe("root certificate initialization", () => {
  test("concurrent Workers all see the same CA certificate lists", async () => {
    // Build a big extra-CA bundle out of the bundled root certs so that the
    // initialization path has a lot of parsing work to do. This widens the
    // race window without depending on what system certs happen to exist on
    // the CI machine.
    const bundled = tls.rootCertificates;
    expect(bundled.length).toBeGreaterThan(50);
    // Repeat the bundle a few times so there's plenty of work.
    const bundle = (bundled.join("\n") + "\n").repeat(3);
    const expectedExtraCount = bundled.length * 3;

    using dir = tempDir("tls-root-certs-race", {
      "extra-ca-bundle.pem": bundle,
      "concurrent-init.fixture.ts": `
        import { Worker } from "node:worker_threads";

        const N = 16;
        const results: Array<{ extra: number; def: number }> = [];
        let messaged = 0;
        let exited = 0;

        function maybeFinish() {
          if (messaged === N && exited === N) {
            process.stdout.write(JSON.stringify(results));
          }
        }

        for (let i = 0; i < N; i++) {
          const w = new Worker(
            \`
              const tls = require("node:tls");
              const extra = tls.getCACertificates("extra");
              const def = tls.getCACertificates("default");
              require("node:worker_threads").parentPort.postMessage({
                extra: extra.length,
                def: def.length,
              });
            \`,
            { eval: true },
          );
          w.on("message", m => {
            results.push(m);
            messaged++;
            maybeFinish();
          });
          w.on("error", err => {
            console.error("worker error:", err);
            process.exit(1);
          });
          w.on("exit", code => {
            if (code !== 0) {
              console.error("worker exited with code", code);
              process.exit(1);
            }
            exited++;
            maybeFinish();
          });
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "concurrent-init.fixture.ts")],
      env: {
        ...bunEnv,
        NODE_EXTRA_CA_CERTS: path.join(String(dir), "extra-ca-bundle.pem"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On unpatched builds this segfaults and writes the crash panel to stderr,
    // so surface that first for a readable failure diff.
    expect(stderr).toBe("");
    expect(stdout).not.toBe("");

    const results = JSON.parse(stdout) as Array<{ extra: number; def: number }>;
    expect(results.length).toBe(16);

    // Every Worker must see the full extra-CA list. Before the fix, threads
    // that raced past the early "initialized" check would observe a partial
    // (or empty) list.
    for (const r of results) {
      expect(r.extra).toBe(expectedExtraCount);
    }

    // And every Worker must agree on the default list as well.
    const firstDefault = results[0].def;
    expect(firstDefault).toBeGreaterThanOrEqual(bundled.length + expectedExtraCount);
    for (const r of results) {
      expect(r.def).toBe(firstDefault);
    }

    expect(exitCode).toBe(0);
  });
});
