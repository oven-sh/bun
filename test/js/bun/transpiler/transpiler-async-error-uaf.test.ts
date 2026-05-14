// Log.to_js (used by Bun.Transpiler().transform/transformSync when rejecting
// with parse errors, and by the module loader via process_fetch_log) builds
// an AggregateError by allocating one BuildMessage JS cell per log entry. The
// Rust port collected those cells in a heap Vec<JSValue>, which the
// conservative GC scan does not see, so an earlier cell could be swept while
// allocating a later one and the AggregateError would reference a zapped
// StructureID.
//
// useZombieMode scribbles 0xbadbeef0 over swept cells so the dangling access
// manifests deterministically; collectContinuously races the collector against
// the allocation loop so it reliably sweeps mid-loop.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const fixture = `
const src = Array.from({ length: 300 }, () => "a b").join("\\n");
const t = new Bun.Transpiler();
for (let i = 0; i < 20; i++) {
  let err;
  try { t.transformSync(src); } catch (e) { err = e; }
  if (!(err instanceof AggregateError)) throw new Error("not AggregateError: " + err);
  if (err.errors.length !== 256) throw new Error("wrong count: " + err.errors.length);
  for (const m of err.errors) {
    const msg = m.message;
    if (msg !== 'Expected ";" but found "b"') {
      throw new Error("corrupt BuildMessage: " + JSON.stringify(typeof msg) + " " + String(msg).slice(0, 80));
    }
  }
}
console.log("OK");
`;

test("Log.to_js roots BuildMessage cells across allocation", async () => {
  using dir = tempDir("log-to-js-gc-root", {
    "fixture.js": fixture,
  });

  // Windows + collectContinuously is prohibitively slow in CI and the code
  // path is platform-agnostic, so rely on zombie mode alone there.
  const gcEnv: Record<string, string | undefined> = {
    ...bunEnv,
    BUN_JSC_useZombieMode: "1",
  };
  if (!isWindows) gcEnv.BUN_JSC_collectContinuously = "1";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: gcEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 60_000);
