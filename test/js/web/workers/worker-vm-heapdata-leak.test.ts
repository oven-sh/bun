import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";

// Each VM (including every worker) allocates a WebCore::JSHeapData on creation
// via JSHeapData::ensureHeapData (the default !useGlobalGC path). It is owned
// by JSVMClientData::m_heapData, which used to be a raw pointer that
// ~JSVMClientData never freed, so every terminated worker leaked its JSHeapData
// plus the FastMalloc-backed IsoSubspaces it embeds — RSS growth proportional
// to the number of `new Worker()` + `terminate()` cycles (~4 KB/worker in
// release, ~25 KB/worker under ASAN).
//
// ASAN/debug builds are slower and have larger per-allocation overhead, so the
// batch is smaller and the threshold wider there. Measured on Linux x64 with
// the leak present vs fixed (3 runs each):
//   debug+ASAN, 200 workers: leaky 5.3–6.8 MB vs fixed −1.2–1.9 MB
//   release,    500 workers: leaky 1.8–2.0 MB vs fixed −0.2–0.7 MB
const slow = isDebug || isASAN;
const BATCH = slow ? 200 : 500;
const LIMIT_MB = slow ? 3.5 : 1.3;

// Skipped on Windows: RSS there does not drop after worker threads exit (the
// per-thread mimalloc arenas stay committed), so allocator residue swamps the
// per-worker leak. The fix is platform-agnostic C++; Linux/macOS coverage is
// sufficient.
test.skipIf(isWindows)(
  "terminated workers do not leak their per-VM heap data (RSS stays bounded)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--smol",
        "-e",
        `
        const url =
          "data:text/javascript," +
          encodeURIComponent('self.onmessage = () => {}; self.postMessage("ready");');

        async function runWorker() {
          const w = new Worker(url, { type: "module" });
          await new Promise((resolve, reject) => {
            w.onmessage = resolve;
            w.onerror = reject;
          });
          w.terminate();
          await new Promise(r => w.addEventListener("close", r, { once: true }));
        }

        // Warm up: establish the allocator/JIT high-water mark so the measured
        // batch only sees steady-state growth.
        for (let i = 0; i < 30; i++) await runWorker();
        Bun.gc(true);
        Bun.gc(true);
        const rssBefore = process.memoryUsage.rss();

        for (let i = 0; i < ${BATCH}; i++) await runWorker();
        Bun.gc(true);
        Bun.gc(true);
        const rssAfter = process.memoryUsage.rss();

        const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;
        if (deltaMB > ${LIMIT_MB}) {
          console.error(
            "LEAK: RSS grew " + deltaMB.toFixed(1) + " MB over ${BATCH} worker create/terminate cycles",
          );
          process.exit(1);
        }
        console.log("PASS delta=" + deltaMB.toFixed(1) + "MB");
      `,
      ],
      env: {
        ...bunEnv,
        // ASAN's quarantine retains freed allocations (hundreds of KB of RSS
        // noise per worker) which would bury the leak signal; disable it so
        // freed memory is released promptly. No effect on non-ASAN builds.
        ASAN_OPTIONS: "quarantine_size_mb=0:thread_local_quarantine_size_kb=0:detect_leaks=0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // ASAN builds emit a one-time "WARNING: ASAN interferes ..." line to stderr
    // (via std::call_once in ZigGlobalObject.cpp) that BUN_DEBUG_QUIET_LOGS does
    // not suppress; filter it before asserting stderr is otherwise clean.
    const stderrLines = stderr.split("\n").filter(line => !line.startsWith("WARNING: ASAN interferes"));
    expect(stderrLines.join("\n")).toBe("");
    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  },
  240_000,
);
