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

// The same fixture, except that the async function that created the server clears its variable before it returns.
// Its generator then keeps no server.
const clearedRun = fixture["run.ts"]
  .replace("const server = Bun.serve({", "let server: any = Bun.serve({")
  .replace(
    "return { fetch: await request, pendingRequestsWhileParked, stopped: server.stop(true) };",
    "const result = { fetch: await request, pendingRequestsWhileParked, stopped: server.stop(true) };\n      server = undefined;\n      return result;",
  );
if (!clearedRun.includes("let server: any") || !clearedRun.includes("server = undefined;")) {
  throw new Error("the fixture changed: the cleared variant was not made");
}

type Run = {
  name: string;
  mode: string;
  probe?: string;
  env?: Record<string, string>;
  cleared?: boolean;
  sanitizeLog?: boolean;
};
const noTimer = { BUN_GC_TIMER_DISABLE: "1" };
const always = { PROBE_ALWAYS: "1" };
const syms = { PROBE_SYMS: "1" };
const sanitizeLog = { PROBE_MARK: "1", BUN_JSC_verboseSanitizeStack: "1" };
const rejection = "plugin setup rejection";
const runs: Run[] = [
  // The test as it is on main, and with no collection at listen.
  { name: "rejection", mode: rejection },
  { name: "rejection noTimer", mode: rejection, env: noTimer },
  // Where the stack word is, in what frame, and since when.
  { name: "early", mode: rejection, probe: "early", env: { ...noTimer, ...syms } },
  { name: "gcwrap", mode: rejection, probe: "gcwrap", env: { ...noTimer, ...syms } },
  { name: "early2", mode: rejection, probe: "early2", env: noTimer },
  // The same where the server is collected: what became of that word.
  { name: "early with timer", mode: rejection, probe: "early", env: { ...always, ...syms } },
  { name: "early2 with timer", mode: rejection, probe: "early2", env: always },
  { name: "early setup noTimer", mode: "plugin setup", probe: "early", env: { ...noTimer, ...always } },
  { name: "early build noTimer", mode: "build", probe: "early", env: { ...noTimer, ...always } },
  // Zero the word in the middle of the loop that fails. The next round should collect the server.
  { name: "poke at 16", mode: rejection, probe: "early", env: { ...noTimer, PROBE_POKE: "16" } },
  { name: "poke at 40", mode: rejection, probe: "early", env: { ...noTimer, PROBE_POKE: "40" } },
  // Where JSC cleared dead stack, relative to the word.
  {
    name: "early sanitize log",
    mode: rejection,
    probe: "early",
    env: { ...noTimer, ...sanitizeLog },
    sanitizeLog: true,
  },
  {
    name: "early with timer sanitize log",
    mode: rejection,
    probe: "early",
    env: { ...always, ...sanitizeLog },
    sanitizeLog: true,
  },
  // The fixture whose async function clears its variable.
  { name: "cleared", mode: rejection, cleared: true },
  { name: "cleared noTimer", mode: rejection, env: noTimer, cleared: true },
];

// BUN_JSC_verboseSanitizeStack=1 prints one line for each time JSC zeroed the stack between the last place it did
// so and the stack pointer. Between two marks of the probe: how many, how many of them were over the word (the word
// was dead stack then), and how many zeroed it.
function summarizeSanitizeLog(stderr: string, word: number | undefined) {
  const intervals: string[] = [];
  let name = "start";
  let count = 0;
  let over = 0;
  let zeroed = 0;
  let lowest = Infinity;
  let highest = -Infinity;
  let lastSp = 0;
  let total = 0;
  const signed = (v: number) => (v < 0 ? "-" : "+") + Math.abs(v).toString(16);
  const flush = () => {
    intervals.push(
      name +
        ": n=" +
        count +
        (word === undefined || count === 0
          ? ""
          : " over=" +
            over +
            " zeroed=" +
            zeroed +
            " sp=" +
            signed(lowest) +
            ".." +
            signed(highest) +
            " last=" +
            signed(lastSp)),
    );
    count = over = zeroed = 0;
    lowest = Infinity;
    highest = -Infinity;
  };
  for (const line of stderr.split("\n")) {
    if (line.startsWith("@@CP ")) {
      flush();
      name = line.slice(5).trim();
      continue;
    }
    const match = /current stack pointer at (?:0x)?([0-9a-fA-F]+), last stack top = (?:0x)?([0-9a-fA-F]+)/.exec(line);
    if (!match) continue;
    total++;
    count++;
    if (word === undefined) continue;
    const sp = parseInt(match[1], 16) - word;
    const last = parseInt(match[2], 16) - word;
    if (sp > 0) over++;
    if (sp > 0 && last <= 0) zeroed++;
    lowest = Math.min(lowest, sp);
    highest = Math.max(highest, sp);
    lastSp = sp;
  }
  flush();
  return { total, intervals };
}

test("diagnostics for the server that is not collected", async () => {
  const results: any[] = [];
  const summary: string[] = [];
  for (const run of runs) {
    const result: any = { name: run.name };
    try {
      using dir = tempDir("serve-probe", {
        ...fixture,
        ...(run.cleared ? { "run.ts": clearedRun } : {}),
        "probe.ts": probe,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...(run.probe ? ["--preload", "./probe.ts"] : []), "run.ts", run.mode],
        env: { ...bunEnv, ...run.env, ...(run.probe ? { PROBE: run.probe } : {}) },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      result.exitCode = exitCode;
      result.signal = proc.signalCode ?? undefined;
      const errors = stderr.replace(/\r/g, "");
      if (!run.sanitizeLog)
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
      if (run.sanitizeLog) {
        const p = result.probe;
        const word =
          p?.native && p?.generator ? Number(p.native.stackBase) - parseInt(p.generator.slotUnderBase, 16) : undefined;
        result.sanitize = summarizeSanitizeLog(errors, word);
        result.stderrBytes = errors.length;
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
            " timeouts=" +
            p.timeoutCalls +
            " generator=" +
            JSON.stringify(p.generator) +
            " slots=" +
            JSON.stringify(p.slots) +
            " hits=" +
            JSON.stringify(p.lateHits) +
            " poke=" +
            JSON.stringify(p.poke) +
            " snapshot=" +
            JSON.stringify(
              (p.snapshot?.servers ?? [])
                .filter((s: any) => s.isInstance)
                .map((s: any) => [
                  s.cell,
                  s.root ?? "",
                  s.unrooted ? "NO ROOT; reached by " + s.reachedBy : s.pathFromRoot,
                ]),
            ) +
            " steps=" +
            JSON.stringify(p.steps) +
            " errors=" +
            JSON.stringify(p.errors)
          : "",
        result.sanitize ? "sanitize total=" + result.sanitize.total : "",
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
  const lines = 50;
  const size = Math.max(1000, Math.ceil(payload.length / lines));
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += size) chunks.push(payload.slice(i, i + size));
  for (const line of summary) console.log("@@S@@ " + line);
  chunks.forEach((chunk, i) => console.log("@@R@@ " + (i + 1) + "/" + chunks.length + " " + chunk));

  // Always fails: the lines above are the result.
  expect("a diagnostic run of " + runs.length + " fixtures on " + process.platform + " " + process.arch).toBe("");
}, 600_000);
