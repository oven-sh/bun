// Bun.Transpiler().transform() runs on a work-pool TransformTask that owns a
// +1 WTFStringImpl for the printed output (BunString::clone_utf8 in run()).
// On the success path transfer_to_js consumes that ref, but when parsing
// succeeds and printing succeeds while the log has a warning (e.g. the
// legacy HTML "-->" single-line-comment lexer warning), then() rejects
// without calling transfer_to_js. BunString is Copy with no Drop, so the
// task's Drop must deref output_code explicitly or the whole printed source
// leaks per rejected call.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const fixture = /* ts */ `
const t = new Bun.Transpiler({ loader: "js" });
// A single large string literal: trivial to parse, and the printed output is
// ~256 KB so the leaked WTFStringImpl is large enough to move RSS measurably.
const payload = Buffer.alloc(256 * 1024, "a").toString();
// "-->" at the start of a line is the legacy HTML single-line close comment:
// the lexer logs a warning (not an error), so parse+print succeed and then()
// takes the reject path with output_code already populated.
const code = 'var big = "' + payload + '";\\n--> trailing\\nbig;\\n';

let rejected = 0;
async function once() {
  try { await t.transform(code); } catch { rejected++; }
}

// Warm up: let the WTF allocator / mimalloc reach steady state before
// measuring.
for (let i = 0; i < 100; i++) await once();
Bun.gc(true);
const before = process.memoryUsage.rss();

for (let i = 0; i < 600; i++) await once();
Bun.gc(true);
const growthMB = (process.memoryUsage.rss() - before) / 1024 / 1024;

// The test is meaningless if transform() did not reject (e.g. the warning
// was removed or the source no longer triggers it).
if (rejected < 700) throw new Error("expected every transform() to reject, got " + rejected + "/700");
// Without the fix: 600 * ~256 KB = ~150 MB retained.
// With the fix: < 5 MB.
if (growthMB > 60) throw new Error("leaked " + growthMB.toFixed(2) + " MB");
console.log("OK growth=" + growthMB.toFixed(2) + "MB");
`;

test("transform() reject path releases the printed output string", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", fixture],
    env: {
      ...bunEnv,
      // RSS-delta leak tests measure retained bytes; ASAN's quarantine
      // (default quarantine_size_mb=256) holds every freed allocation
      // poisoned-but-resident, which in this test is 700 * ~256 KB of freed
      // output strings and dominates the delta even when nothing leaks.
      // Disable quarantine for the measurement subprocess only.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(stdout.trim()).toStartWith("OK ");
  expect(exitCode).toBe(0);
}, 60_000);
