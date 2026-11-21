import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// TEMPORARY, NOT FOR MERGE. It collects facts from the CI machines about a server that Bun.gc(true) does not collect
// on Windows x64 when no collection ran at listen, and always fails so that CI shows what it printed.
//
// It runs the fixture of bun-serve-html-build-holds-server.test.ts unchanged. The probe is a --preload script, so
// run.ts keeps its bytes and its frames.
const source = await Bun.file(join(import.meta.dir, "bun-serve-html-build-holds-server.test.ts")).text();
const from = source.indexOf("{", source.indexOf("const fixture = {"));
const to = source.indexOf("test.concurrent.each(");
const fixture: Record<string, string> = new Function("return " + source.slice(from, to).trim().replace(/;$/, ""))();
const probe = await Bun.file(join(import.meta.dir, "bun-serve-html-build-holds-server-probe.fixture.ts")).text();

type Run = { name: string; mode: string; probe?: string; env?: Record<string, string> };
const noTimer = { BUN_GC_TIMER_DISABLE: "1" };
const always = { PROBE_ALWAYS: "1" };
const rejection = "plugin setup rejection";
const runs: Run[] = [
  // The test as it is on main, and with no collection at listen.
  { name: "rejection", mode: rejection },
  { name: "rejection noTimer", mode: rejection, env: noTimer },
  { name: "setup noTimer", mode: "plugin setup", env: noTimer },
  { name: "build noTimer", mode: "build", env: noTimer },
  // What changes the answer.
  { name: "rejection noTimer noJIT", mode: rejection, env: { ...noTimer, BUN_JSC_useJIT: "0" } },
  { name: "rejection noTimer noDFG", mode: rejection, env: { ...noTimer, BUN_JSC_useDFGJIT: "0" } },
  { name: "rejection noTimer noConcurrentGC", mode: rejection, env: { ...noTimer, BUN_JSC_useConcurrentGC: "0" } },
  { name: "rejection noTimer 1 marker", mode: rejection, env: { ...noTimer, BUN_JSC_numberOfGCMarkers: "1" } },
  { name: "rejection noTimer noGenerational", mode: rejection, env: { ...noTimer, BUN_JSC_useGenerationalGC: "0" } },
  // The probes, from the least intrusive.
  { name: "snap", mode: rejection, probe: "snap", env: noTimer },
  { name: "late", mode: rejection, probe: "late", env: noTimer },
  { name: "lateref", mode: rejection, probe: "lateref", env: noTimer },
  { name: "early", mode: rejection, probe: "early", env: noTimer },
  { name: "early2", mode: rejection, probe: "early2", env: noTimer },
  { name: "gcwrap", mode: rejection, probe: "gcwrap", env: noTimer },
  // Bun.gc through one more JS frame, and the same after a recursion overwrote the stack under that frame.
  { name: "gc shift", mode: rejection, probe: "snap", env: { ...noTimer, PROBE_GC: "shift" } },
  { name: "gc clobber", mode: rejection, probe: "snap", env: { ...noTimer, PROBE_GC: "clobber" } },
  // The same probes where the server is expected to be collected, to compare.
  { name: "early with timer", mode: rejection, probe: "early", env: always },
  { name: "early2 with timer", mode: rejection, probe: "early2", env: always },
  { name: "gcwrap with timer", mode: rejection, probe: "gcwrap", env: always },
  { name: "early setup noTimer", mode: "plugin setup", probe: "early", env: { ...noTimer, ...always } },
  { name: "early build noTimer", mode: "build", probe: "early", env: { ...noTimer, ...always } },
];

test("diagnostics for the server that is not collected", async () => {
  const results: any[] = [];
  const summary: string[] = [];
  for (const run of runs) {
    const result: any = { name: run.name };
    try {
      using dir = tempDir("serve-probe", { ...fixture, "probe.ts": probe });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...(run.probe ? ["--preload", "./probe.ts"] : []), "run.ts", run.mode],
        env: { ...bunEnv, ...run.env, ...(run.probe ? { PROBE: run.probe } : {}) },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      result.exitCode = exitCode;
      result.signal = proc.signalCode ?? undefined;
      const errors = stderr.replace(/\r/g, "");
      result.stderr = errors.length > 1500 ? errors.slice(0, 700) + " [...] " + errors.slice(-700) : errors;
      for (const line of stdout.replace(/\r/g, "").split("\n")) {
        if (line.startsWith("@@PROBE@@")) {
          try {
            result.probe = JSON.parse(Buffer.from(Bun.gunzipSync(Buffer.from(line.slice(9), "base64"))).toString());
          } catch (e) {
            result.probeError = String(e);
          }
        } else if (line.startsWith("{")) result.fixture = line;
        else if (line) (result.other ??= []).push(line.slice(0, 300));
      }
    } catch (e: any) {
      result.error = String(e?.stack ?? e).slice(0, 600);
    }
    results.push(result);
    const p = result.probe;
    summary.push(
      [
        run.name,
        "exit=" + result.exitCode + (result.signal ? "/" + result.signal : ""),
        /"collectedAfterwards":(\w+)/.exec(result.fixture ?? "")?.[0] ??
          "no report: " + (result.error ?? result.stderr?.slice(-200)),
        p
          ? "live=" +
            [p.liveServersAtFailure, p.liveServersAfterSnapshot].join(">") +
            " cell=" +
            p.serverCell +
            " hits=" +
            JSON.stringify(p.lateHits) +
            " slots=" +
            JSON.stringify(p.slots) +
            " snapshot=" +
            JSON.stringify(
              (p.snapshot?.servers ?? [])
                .filter((s: any) => s.isInstance)
                .map((s: any) => [
                  s.cell,
                  s.addr,
                  s.root ?? "",
                  s.unrooted ? "NO ROOT; reached by " + s.reachedBy : s.pathFromRoot,
                ]),
            ) +
            " steps=" +
            JSON.stringify(p.steps) +
            " errors=" +
            JSON.stringify(p.errors)
          : "",
      ].join(" | "),
    );
  }

  const payload = Buffer.from(
    Bun.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform: process.platform,
          arch: process.arch,
          version: Bun.version,
          revision: Bun.revision,
          results,
        }),
      ),
    ),
  ).toString("base64");
  const lines = 40;
  const size = Math.max(1000, Math.ceil(payload.length / lines));
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += size) chunks.push(payload.slice(i, i + size));
  for (const line of summary) console.log("@@S@@ " + line);
  chunks.forEach((chunk, i) => console.log("@@R@@ " + (i + 1) + "/" + chunks.length + " " + chunk));

  // Always fails: the lines above are the result.
  expect("a diagnostic run of " + runs.length + " fixtures on " + process.platform + " " + process.arch).toBe("");
}, 600_000);
